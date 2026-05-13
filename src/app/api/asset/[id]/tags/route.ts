import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import {
  decodeTags,
  encodeTags,
  normalizeTags,
  TagsValidationError,
} from '@/lib/asset/tags';

/**
 * PUT /api/asset/[id]/tags
 *
 * Replace the full tag set on an asset owned by the current user (TM-107).
 *
 * Body: { tags: string[] }
 *   - Each tag is trimmed; empty entries are dropped silently.
 *   - Per-tag length and total-count limits enforced (see helper).
 *   - Duplicates collapsed to first occurrence.
 *
 * Soft-deleted assets are treated as not-found so we don't silently retag
 * trash. Owner-only.
 *
 * Response: { id, tags }
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { tags?: unknown } = {};
  try {
    body = (await req.json()) as { tags?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let tags: string[];
  try {
    tags = normalizeTags(body.tags);
  } catch (err) {
    const msg = err instanceof TagsValidationError ? err.message : 'Invalid tags';
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
    data: { tags: encodeTags(tags) },
    select: { id: true },
  });

  return NextResponse.json({ id, tags });
}

/**
 * GET /api/asset/[id]/tags — convenience read; primarily used by tests.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, userId: true, deletedAt: true, tags: true },
  });
  if (!row || row.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ id, tags: decodeTags(row.tags) });
}
