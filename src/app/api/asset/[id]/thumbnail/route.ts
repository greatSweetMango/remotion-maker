/**
 * /api/asset/[id]/thumbnail — user-uploaded asset thumbnail (TM-109).
 *
 * POST   multipart/form-data { file } → upload + persist `Asset.thumbnailUrl`
 * DELETE                              → clear `Asset.thumbnailUrl` and
 *                                       remove the on-disk file (best-effort)
 *
 * Storage policy (per TeamLead spec): local-only filesystem under
 * `public/uploads/thumbnails/<assetId>.<ext>`. No R2/S3 here — production
 * migration is a separate task. Note that on serverless deployments with
 * ephemeral filesystems this storage will not survive a redeploy; the dev
 * usage path (single Next server) is the supported path until that follow-up.
 *
 * Validation:
 *   - content-type must be image/png|jpeg|webp (extension fallback for safari
 *     uploads that occasionally come through with empty MIME)
 *   - size ≤ 1 MiB (1 048 576 bytes) — generous for a card-sized thumbnail
 *
 * Auth: NextAuth session required; caller must own the asset; soft-deleted
 * assets are treated as not-found so we don't quietly mutate trashed rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

export const MAX_THUMBNAIL_BYTES = 1 * 1024 * 1024; // 1 MiB

export const ALLOWED_THUMBNAIL_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const ALLOWED_EXT = new Set<string>(['png', 'jpg', 'jpeg', 'webp']);

function pickExtension(mime: string, filename: string): string | null {
  if (mime && EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  return null;
}

function thumbnailDir(): string {
  // process.cwd() is the Next app root in both dev and production builds.
  return path.join(process.cwd(), 'public', 'uploads', 'thumbnails');
}

function publicUrl(assetId: string, ext: string): string {
  return `/uploads/thumbnails/${assetId}.${ext}`;
}

/**
 * Best-effort: remove every previous thumbnail for this asset (any extension).
 * We don't fail the request when unlink errors — the DB pointer is the source
 * of truth and the orphan file is harmless.
 */
async function removeExistingThumbnails(assetId: string): Promise<void> {
  const dir = thumbnailDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((f) => f.startsWith(`${assetId}.`))
      .map((f) =>
        fs.unlink(path.join(dir, f)).catch(() => {
          /* ignore */
        }),
      ),
  );
}

async function loadOwnedAsset(
  id: string,
  userId: string,
): Promise<
  | { ok: true; status: 200 }
  | { ok: false; status: 404 | 403 }
> {
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, userId: true, deletedAt: true },
  });
  if (!asset || asset.deletedAt) return { ok: false, status: 404 };
  if (asset.userId !== userId) return { ok: false, status: 403 };
  return { ok: true, status: 200 };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field' }, { status: 400 });
  }

  const mime = file.type || '';
  const ext = pickExtension(mime, file.name);
  if (!ext) {
    return NextResponse.json(
      {
        error: `Unsupported image type. Allowed: png, jpg, webp (got "${
          mime || path.extname(file.name) || 'unknown'
        }")`,
      },
      { status: 415 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }
  if (file.size > MAX_THUMBNAIL_BYTES) {
    const maxKb = Math.round(MAX_THUMBNAIL_BYTES / 1024);
    return NextResponse.json(
      { error: `Thumbnail too large (max ${maxKb} KB)` },
      { status: 413 },
    );
  }

  // Auth/ownership check before touching the filesystem so a forbidden caller
  // can't burn disk by uploading large bodies that succeed only to be wiped.
  const owner = await loadOwnedAsset(id, session.user.id);
  if (!owner.ok) {
    return NextResponse.json(
      { error: owner.status === 404 ? 'Not found' : 'Forbidden' },
      { status: owner.status },
    );
  }

  const dir = thumbnailDir();
  await fs.mkdir(dir, { recursive: true });

  // Wipe any prior thumbnails for this asset across other extensions so we
  // never end up with `<id>.png` *and* `<id>.webp` racing for the URL.
  await removeExistingThumbnails(id);

  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, `${id}.${ext}`), buf);

  // Cache-bust by appending the byte length — the client just refetches when
  // the URL changes, no Cache-Control headers needed for a `public/` path.
  const url = `${publicUrl(id, ext)}?v=${file.size}`;

  await prisma.asset.update({
    where: { id },
    data: { thumbnailUrl: url },
    select: { id: true },
  });

  return NextResponse.json({ id, thumbnailUrl: url }, { status: 200 });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const owner = await loadOwnedAsset(id, session.user.id);
  if (!owner.ok) {
    return NextResponse.json(
      { error: owner.status === 404 ? 'Not found' : 'Forbidden' },
      { status: owner.status },
    );
  }

  await removeExistingThumbnails(id);
  await prisma.asset.update({
    where: { id },
    data: { thumbnailUrl: null },
    select: { id: true },
  });

  return NextResponse.json({ id, thumbnailUrl: null });
}
