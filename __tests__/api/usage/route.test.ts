/**
 * TM-189 — coverage hot-spot: GET /api/usage.
 *
 * Pins auth gating (401), missing-user (404), and the success payload shape
 * (tier / monthlyUsage / monthlyLimit derived from TIER_LIMITS / parsed
 * editUsage). Auth + prisma are mocked so the test is offline and DB-free.
 */
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/usage/route';
import { TIER_LIMITS } from '@/lib/usage';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedUser = (prisma as unknown as { user: { findUnique: jest.Mock } }).user;

type AuthRet = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const session = (id: string) => ({ user: { id } } as unknown as AuthRet);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/usage', () => {
  it('returns 401 when there is no session', async () => {
    mockedAuth.mockResolvedValue(null as unknown as AuthRet);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockedUser.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the session user is not found in the DB', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    mockedUser.findUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('returns tier, usage, derived monthlyLimit and parsed editUsage', async () => {
    mockedAuth.mockResolvedValue(session('u1'));
    const resetAt = new Date('2026-07-01T00:00:00.000Z');
    mockedUser.findUnique.mockResolvedValue({
      id: 'u1',
      tier: 'FREE',
      monthlyUsage: 3,
      editUsage: JSON.stringify({ '2026-06': 5 }),
      usageResetAt: resetAt,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tier: string;
      monthlyUsage: number;
      monthlyLimit: number;
      editUsage: Record<string, number>;
      usageResetAt: string;
    };
    expect(body.tier).toBe('FREE');
    expect(body.monthlyUsage).toBe(3);
    expect(body.monthlyLimit).toBe(TIER_LIMITS.FREE.monthlyGenerations);
    expect(body.editUsage).toEqual({ '2026-06': 5 });
    // scopes the lookup to the session user
    expect(mockedUser.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('uses the PRO limit for PRO-tier users', async () => {
    mockedAuth.mockResolvedValue(session('u2'));
    mockedUser.findUnique.mockResolvedValue({
      id: 'u2',
      tier: 'PRO',
      monthlyUsage: 0,
      editUsage: JSON.stringify({}),
      usageResetAt: new Date(),
    });
    const res = await GET();
    const body = (await res.json()) as { monthlyLimit: number };
    expect(body.monthlyLimit).toBe(TIER_LIMITS.PRO.monthlyGenerations);
  });
});
