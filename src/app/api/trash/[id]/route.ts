import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

/**
 * DELETE /api/trash/[id]
 *
 * Hard-delete an asset that is currently in the user's trash
 * (`deletedAt != null`). Removes the row permanently; AssetVersion rows
 * cascade via the schema's `onDelete: Cascade`.
 *
 * Auth: required. Owner-only. To prevent accidental hard-delete of live
 * assets, this endpoint refuses if the asset is NOT currently soft-deleted —
 * use `DELETE /api/asset/[id]` to send something to trash first.
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
  if (!asset.deletedAt) {
    return NextResponse.json(
      { error: 'Asset is not in trash. Soft-delete first via DELETE /api/asset/[id].' },
      { status: 409 }
    );
  }

  await prisma.asset.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
