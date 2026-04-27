/**
 * Tests for purgeExpiredTrash — 30-day cutoff, user-scoping. (TM-18)
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { asset: { deleteMany: jest.fn() } },
}));

import { prisma } from '@/lib/db/prisma';
import { purgeExpiredTrash, TRASH_RETENTION_MS, TRASH_RETENTION_DAYS } from '@/lib/trash/cleanup';

const mockedDeleteMany = (
  prisma as unknown as { asset: { deleteMany: jest.Mock } }
).asset.deleteMany;

beforeEach(() => {
  jest.clearAllMocks();
  mockedDeleteMany.mockResolvedValue({ count: 3 });
});

describe('purgeExpiredTrash', () => {
  it('uses 30-day retention window', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(TRASH_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('hard-deletes only the given user’s rows older than the cutoff', async () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const count = await purgeExpiredTrash('user-A', now);
    expect(count).toBe(3);
    expect(mockedDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-A',
        deletedAt: {
          lt: new Date(now.getTime() - TRASH_RETENTION_MS),
          not: null,
        },
      },
    });
  });

  it('never deletes rows where deletedAt is null', async () => {
    await purgeExpiredTrash('user-A');
    const args = mockedDeleteMany.mock.calls[0][0];
    expect(args.where.deletedAt.not).toBeNull();
  });
});
