import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

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
