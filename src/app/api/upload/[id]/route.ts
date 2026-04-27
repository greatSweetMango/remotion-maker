/**
 * DELETE /api/upload/[id] — remove a user's uploaded asset.
 * Owner-only. Best-effort delete from the storage backend, then DB row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { getStorageProvider } from '@/lib/storage';

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const upload = await prisma.uploadedAsset.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (upload.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Best-effort backend delete; we always remove the DB row even if the
  // storage delete fails (orphaned blob is preferable to a stuck row).
  const provider = getStorageProvider();
  await provider.delete(upload.storageKey).catch(() => false);

  await prisma.uploadedAsset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
