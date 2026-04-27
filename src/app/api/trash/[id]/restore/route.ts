import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

/**
 * POST /api/trash/[id]/restore
 *
 * Restore a soft-deleted asset back into the user's library by clearing
 * `deletedAt`. Owner-only. Idempotent — restoring an already-restored asset
 * (deletedAt: null) returns ok.
 */
export async function POST(
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

  if (!asset.deletedAt) {
    return NextResponse.json({ ok: true, alreadyRestored: true });
  }

  await prisma.asset.update({
    where: { id },
    data: { deletedAt: null },
  });

  return NextResponse.json({ ok: true });
}
