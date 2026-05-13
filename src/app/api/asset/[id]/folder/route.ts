import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { normalizeFolder, TagsValidationError } from '@/lib/asset/tags';

/**
 * PATCH /api/asset/[id]/folder
 *
 * Move an asset into a folder, or remove it from any folder (TM-107).
 *
 * Body: { folder: string | null }
 *   - `null` or `""` => move to root (NULL in DB)
 *   - non-empty string => folder name (validated by helper)
 *
 * Owner-only; soft-deleted assets behave as not-found.
 *
 * Response: { id, folder }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { folder?: unknown } = {};
  try {
    body = (await req.json()) as { folder?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!('folder' in body)) {
    return NextResponse.json({ error: 'Missing field: folder' }, { status: 400 });
  }

  let folder: string | null;
  try {
    folder = normalizeFolder(body.folder);
  } catch (err) {
    const msg = err instanceof TagsValidationError ? err.message : 'Invalid folder';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, userId: true, deletedAt: true },
  });
  if (!asset || asset.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.asset.update({
    where: { id },
    data: { folder },
    select: { id: true },
  });

  return NextResponse.json({ id, folder });
}
