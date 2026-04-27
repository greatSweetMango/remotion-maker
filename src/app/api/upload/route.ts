/**
 * /api/upload — user image / font uploads (TM-31).
 *
 * GET  → list current user's uploads (optionally filtered by `?kind=image|font`)
 * POST → multipart/form-data with fields:
 *          - file:   the binary
 *          - kind:   'image' | 'font'
 *
 * Validation:
 *   - MIME against allowlist (storage/index.ts)
 *   - size limit per kind
 *   - per-tier quota (usage.ts → checkUploadLimit)
 *
 * Storage backend selected by `getStorageProvider()`. In dev / CI without a
 * Vercel Blob token this writes to a local placeholder dir — the API contract
 * is identical so the UI can be developed before prod creds are provisioned.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { checkUploadLimit } from '@/lib/usage';
import {
  getStorageProvider,
  ALLOWED_IMAGE_MIME,
  ALLOWED_FONT_MIME,
  FONT_EXT,
  IMAGE_EXT,
  MAX_IMAGE_BYTES,
  MAX_FONT_BYTES,
} from '@/lib/storage';

function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload';
}

function deriveFontFamily(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  return stem.replace(/[^a-zA-Z0-9]/g, '') || 'CustomFont';
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const kind = req.nextUrl.searchParams.get('kind');
  const where: { userId: string; kind?: string } = { userId: session.user.id };
  if (kind === 'image' || kind === 'font') where.kind = kind;

  const uploads = await prisma.uploadedAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ uploads });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  const kindRaw = form.get('kind');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field' }, { status: 400 });
  }
  if (kindRaw !== 'image' && kindRaw !== 'font') {
    return NextResponse.json({ error: '`kind` must be "image" or "font"' }, { status: 400 });
  }
  const kind = kindRaw;

  // MIME + extension validation
  const mime = file.type || 'application/octet-stream';
  const ext = path.extname(file.name).replace('.', '').toLowerCase();
  if (kind === 'image') {
    if (!ALLOWED_IMAGE_MIME.has(mime) && !IMAGE_EXT.has(ext)) {
      return NextResponse.json({ error: `Unsupported image type: ${mime || ext}` }, { status: 415 });
    }
  } else {
    // fonts
    if (!ALLOWED_FONT_MIME.has(mime) && !FONT_EXT.has(ext)) {
      return NextResponse.json({ error: `Unsupported font type: ${mime || ext}` }, { status: 415 });
    }
    if (!FONT_EXT.has(ext)) {
      return NextResponse.json({ error: 'Font filename must end in .otf/.ttf/.woff/.woff2' }, { status: 415 });
    }
  }

  // Size limits
  const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_FONT_BYTES;
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    return NextResponse.json(
      { error: `File too large (max ${maxMb} MB for ${kind})` },
      { status: 413 },
    );
  }

  // Quota
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const currentCount = await prisma.uploadedAsset.count({ where: { userId, kind } });
  const quota = checkUploadLimit({ tier: user.tier as 'FREE' | 'PRO', kind, currentCount });
  if (!quota.allowed) {
    return NextResponse.json({ error: quota.reason, upgradeRequired: true }, { status: 403 });
  }

  // Persist
  const buf = Buffer.from(await file.arrayBuffer());
  const filename = sanitizeFilename(file.name);
  const provider = getStorageProvider();
  const stored = await provider.put({
    userId,
    kind,
    filename,
    mimeType: mime,
    body: buf,
  });

  const record = await prisma.uploadedAsset.create({
    data: {
      userId,
      kind,
      filename,
      mimeType: mime,
      sizeBytes: file.size,
      url: stored.url,
      storageKey: stored.storageKey,
      storageProvider: stored.provider,
      fontFamily: kind === 'font' ? deriveFontFamily(filename) : null,
    },
  });

  return NextResponse.json({ upload: record }, { status: 201 });
}
