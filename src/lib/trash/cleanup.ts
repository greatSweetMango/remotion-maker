import { prisma } from '@/lib/db/prisma';

/**
 * Trash retention window — items soft-deleted longer than this are eligible
 * for lazy hard-delete (TM-18).
 */
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Hard-delete the current user's trashed assets that have been in the trash
 * longer than {@link TRASH_RETENTION_DAYS}. Scoped strictly to `userId` to
 * avoid cross-user side effects.
 *
 * Returns the number of rows hard-deleted. Safe to call on every trash fetch.
 *
 * AssetVersion rows cascade automatically via the schema's
 * `onDelete: Cascade` relation.
 */
export async function purgeExpiredTrash(userId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
  const result = await prisma.asset.deleteMany({
    where: {
      userId,
      deletedAt: { lt: cutoff, not: null },
    },
  });
  return result.count;
}
