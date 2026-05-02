/**
 * TM-92 — quota TOCTOU regression test.
 *
 * Reproduces the TM-83-discovered race: 10 concurrent FREE-tier requests
 * at usage=0 (limit=3). Only 3 should pass, 7 should be rejected with 429.
 *
 * The fix is in src/app/api/generate/route.ts: a single conditional
 * `prisma.user.updateMany({ where: { monthlyUsage: { lt: limit } } })`
 * reserves the slot atomically before generation. The mock for updateMany
 * here serializes its closure-state mutations to model the SQLite
 * "single-statement is atomic" semantics.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    asset: { create: jest.fn() },
  },
}));

jest.mock('@/lib/ai/generate', () => ({ generateAsset: jest.fn() }));
jest.mock('@/lib/ai/client', () => ({
  getModels: () => ({ free: 'm-free', pro: 'm-pro' }),
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { POST } from '@/app/api/generate/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedGenerate = generateAsset as jest.MockedFunction<typeof generateAsset>;
const m = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  asset: { create: jest.Mock };
};

function buildReq(): NextRequest {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'make a blue circle' }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/generate — TM-92 quota TOCTOU', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  });

  it('rejects all but `limit` of N concurrent FREE requests at usage=0', async () => {
    // Shared counter modeling the row's monthlyUsage. The route's updateMany
    // must be the *only* mutator from the gate path; a mutex around the
    // read-then-write models SQLite's atomic conditional update.
    const FREE_LIMIT = 3;
    let monthlyUsage = 0;
    let updateManyMutex: Promise<void> = Promise.resolve();

    m.user.findUnique.mockImplementation(async () => ({
      id: 'u-1',
      tier: 'FREE',
      monthlyUsage,
      usageResetAt: new Date(),
      editUsage: '{}',
    }));

    m.user.updateMany.mockImplementation(async (args: {
      where: { monthlyUsage?: { lt: number } };
    }) => {
      // Serialize: each updateMany completes its compare+increment before
      // the next one begins. This is the invariant the fix relies on.
      const release = updateManyMutex;
      let resolveNext!: () => void;
      updateManyMutex = new Promise<void>((r) => (resolveNext = r));
      await release;
      try {
        const cap = args.where.monthlyUsage?.lt ?? Infinity;
        if (monthlyUsage < cap) {
          monthlyUsage += 1;
          return { count: 1 };
        }
        return { count: 0 };
      } finally {
        resolveNext();
      }
    });

    m.user.update.mockImplementation(async (args: {
      data: { monthlyUsage?: { decrement?: number; increment?: number } };
    }) => {
      const d = args.data.monthlyUsage;
      if (d?.decrement) monthlyUsage -= d.decrement;
      if (d?.increment) monthlyUsage += d.increment;
      return {};
    });

    // Simulated LLM latency so requests overlap.
    mockedGenerate.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return {
        type: 'generate',
        asset: {
          title: 't', code: 'c', jsCode: 'jc', parameters: [],
          durationInFrames: 60, fps: 30, width: 1920, height: 1080,
        },
      } as never;
    });
    m.asset.create.mockResolvedValue({ id: 'a-1' });

    const N = 10;
    const responses = await Promise.all(
      Array.from({ length: N }, () => POST(buildReq())),
    );
    const statuses = responses.map((r) => r.status);
    const ok = statuses.filter((s) => s === 200).length;
    const tooMany = statuses.filter((s) => s === 429).length;

    expect(ok).toBe(FREE_LIMIT);
    expect(tooMany).toBe(N - FREE_LIMIT);
    expect(monthlyUsage).toBe(FREE_LIMIT);
    // generateAsset must NOT run for rejected requests — quota check happens first.
    expect(mockedGenerate).toHaveBeenCalledTimes(FREE_LIMIT);
  });

  it('refunds the reserved slot when the result is `clarify` (no charge)', async () => {
    let monthlyUsage = 0;
    m.user.findUnique.mockResolvedValue({
      id: 'u-1', tier: 'FREE', monthlyUsage: 0,
      usageResetAt: new Date(), editUsage: '{}',
    });
    m.user.updateMany.mockImplementation(async () => {
      monthlyUsage += 1;
      return { count: 1 };
    });
    m.user.update.mockImplementation(async (args: {
      data: { monthlyUsage?: { decrement?: number } };
    }) => {
      if (args.data.monthlyUsage?.decrement) monthlyUsage -= args.data.monthlyUsage.decrement;
      return {};
    });
    mockedGenerate.mockResolvedValue({
      type: 'clarify',
      questions: [{ id: 'q1', text: 'what color?', choices: ['red'] }],
    } as never);

    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('clarify');
    expect(monthlyUsage).toBe(0);
  });
});
