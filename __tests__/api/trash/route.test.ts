/**
 * Tests for GET /api/trash — owner scoping, lazy 30-day cleanup, ordering. (TM-18)
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    asset: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/trash/route';
import { TRASH_RETENTION_MS, TRASH_RETENTION_DAYS } from '@/lib/trash/cleanup';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedAsset = (
  prisma as unknown as {
    asset: { findMany: jest.Mock; deleteMany: jest.Mock };
  }
).asset;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);

const req = () => new NextRequest('http://localhost/api/trash');

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsset.findMany.mockResolvedValue([]);
  mockedAsset.deleteMany.mockResolvedValue({ count: 0 });
});

describe('GET /api/trash', () => {
  it('returns 401 when no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('lists trashed items scoped to current user, deletedAt-desc ordered', async () => {
    mockedAuth.mockResolvedValue(session('user-A'));
    await GET(req());
    const args = mockedAsset.findMany.mock.calls[0][0];
    expect(args.where.userId).toBe('user-A');
    expect(args.where.deletedAt).toEqual({ not: null });
    expect(args.orderBy).toEqual({ deletedAt: 'desc' });
  });

  it('runs lazy 30-day cleanup before listing — scoped to current user', async () => {
    mockedAuth.mockResolvedValue(session('user-A'));
    await GET(req());
    expect(mockedAsset.deleteMany).toHaveBeenCalledTimes(1);
    const args = mockedAsset.deleteMany.mock.calls[0][0];
    expect(args.where.userId).toBe('user-A');
    expect(args.where.deletedAt.not).toBeNull();
    expect(args.where.deletedAt.lt).toBeInstanceOf(Date);
    // Cutoff should be ~30 days before now (allow generous slack to avoid flakes).
    const cutoff = (args.where.deletedAt.lt as Date).getTime();
    const expected = Date.now() - TRASH_RETENTION_MS;
    expect(Math.abs(cutoff - expected)).toBeLessThan(5_000);
  });

  it('cleanup happens before listing (deleteMany invoked first)', async () => {
    mockedAuth.mockResolvedValue(session('user-A'));
    const order: string[] = [];
    mockedAsset.deleteMany.mockImplementation(async () => {
      order.push('deleteMany');
      return { count: 0 };
    });
    mockedAsset.findMany.mockImplementation(async () => {
      order.push('findMany');
      return [];
    });
    await GET(req());
    expect(order).toEqual(['deleteMany', 'findMany']);
  });

  it('exposes retentionDays in response', async () => {
    mockedAuth.mockResolvedValue(session('user-A'));
    const res = await GET(req());
    const body = await res.json();
    expect(body.retentionDays).toBe(TRASH_RETENTION_DAYS);
  });
});
