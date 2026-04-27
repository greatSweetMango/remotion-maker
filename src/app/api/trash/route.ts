import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from '@/lib/trash/cleanup';

/**
 * GET /api/trash
 *
 * List the current user's soft-deleted assets, most-recently-deleted first.
 * Performs lazy cleanup of items older than {@link TRASH_RETENTION_DAYS}
 * before returning, so callers only ever see items still within the
 * restorable window (TM-18).
 *
 * Auth: required. Strictly user-scoped — never returns rows from other users.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();

  // Lazy cleanup first — keeps the returned list within the retention window.
  await purgeExpiredTrash(userId, now);

  const items = await prisma.asset.findMany({
    where: {
      userId,
      deletedAt: { not: null },
    },
    orderBy: { deletedAt: 'desc' },
    select: {
      id: true,
      title: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { versions: true } },
    },
  });

  return NextResponse.json({
    items,
    retentionDays: TRASH_RETENTION_DAYS,
  });
}
