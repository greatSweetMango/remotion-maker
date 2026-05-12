import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

const MAX_TITLE_LENGTH = 200;

/**
 * PATCH /api/asset/[id]
 *
 * Update mutable user-facing fields on an asset owned by the current user.
 * Currently supports `title` only — used by the dashboard "Rename" action
 * (TM-87). Generated code / parameters are mutated via the studio edit flow,
 * not this endpoint.
 *
 * Body: { title?: string }
 *   - `title` is trimmed; must be 1..200 chars after trim. Empty/whitespace
 *     titles reject with 400 so the dashboard list never shows blank rows.
 *
 * Auth: required. Caller must own the asset; soft-deleted assets are
 * treated as not-found so renames don't accidentally resurrect them from
 * the trash silently.
 *
 * Response: { id, title, updatedAt }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { title?: unknown } = {};
  try {
    body = (await req.json()) as { title?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.title !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid field: title' },
      { status: 400 },
    );
  }
  const title = body.title.trim();
  if (title.length === 0) {
    return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Title too long (max ${MAX_TITLE_LENGTH} chars)` },
      { status: 400 },
    );
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

  const updated = await prisma.asset.update({
    where: { id },
    data: { title },
    select: { id: true, title: true, updatedAt: true },
  });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/asset/[id]
 *
 * Soft-delete an asset owned by the current user. The row is preserved with
 * `deletedAt = now()` so it can be restored from `/trash` within 30 days
 * (TM-18). Items older than 30 days are hard-deleted lazily on next
 * `GET /api/trash`.
 *
 * Auth: required (NextAuth session). Caller must own the asset.
 * Idempotent — already-deleted assets return ok.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, userId: true, deletedAt: true },
  });
  if (!asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (asset.deletedAt) {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  await prisma.asset.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
