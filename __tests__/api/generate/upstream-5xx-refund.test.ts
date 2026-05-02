/**
 * TM-82 — quota refund on upstream 5xx / timeout.
 *
 * If the LLM provider returns a 5xx (or the request times out) AFTER we
 * have already atomically reserved a quota slot (TM-92 fix), the route
 * must refund the slot — otherwise users would lose monthly quota for
 * failures they didn't cause and can't recover from. This test pins
 * that behavior at the route boundary.
 *
 * The fix already exists in src/app/api/generate/route.ts line 145 — the
 * catch-all branch issues `monthlyUsage: { decrement: 1 }`. We assert it.
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
    body: JSON.stringify({ prompt: 'a calm blue circle pulsing' }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/generate — TM-82 upstream 5xx refunds quota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
    m.user.findUnique.mockResolvedValue({
      id: 'u-1',
      tier: 'FREE',
      monthlyUsage: 0,
      usageResetAt: new Date(),
      editUsage: '{}',
    });
    m.user.updateMany.mockResolvedValue({ count: 1 });
    m.user.update.mockResolvedValue({});
  });

  it('refunds reserved slot when generateAsset throws (5xx upstream)', async () => {
    mockedGenerate.mockRejectedValue(
      Object.assign(new Error('Service Unavailable'), { status: 503 }),
    );

    const res = await POST(buildReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Service Unavailable/);

    // Quota must have been refunded (decrement) — otherwise users lose
    // monthly slots to upstream provider failures.
    const decrementCalls = m.user.update.mock.calls.filter(
      (c) =>
        c[0]?.data?.monthlyUsage &&
        typeof c[0].data.monthlyUsage === 'object' &&
        'decrement' in c[0].data.monthlyUsage,
    );
    expect(decrementCalls.length).toBe(1);
  });

  it('refunds on timeout (AbortError) too', async () => {
    const abortErr = new Error('Request timed out');
    abortErr.name = 'AbortError';
    mockedGenerate.mockRejectedValue(abortErr);

    const res = await POST(buildReq());
    expect(res.status).toBe(500);

    const decrementCalls = m.user.update.mock.calls.filter(
      (c) =>
        c[0]?.data?.monthlyUsage &&
        typeof c[0].data.monthlyUsage === 'object' &&
        'decrement' in c[0].data.monthlyUsage,
    );
    expect(decrementCalls.length).toBe(1);
  });

  it('repeated retry after a 5xx does NOT double-charge — each failed call refunds', async () => {
    // Simulates user clicking Retry after a 5xx. Two calls, both fail,
    // both refund. Net usage delta after both attempts: 0.
    mockedGenerate.mockRejectedValue(
      Object.assign(new Error('Service Unavailable'), { status: 503 }),
    );

    await POST(buildReq());
    await POST(buildReq());

    const decrementCalls = m.user.update.mock.calls.filter(
      (c) =>
        c[0]?.data?.monthlyUsage &&
        typeof c[0].data.monthlyUsage === 'object' &&
        'decrement' in c[0].data.monthlyUsage,
    );
    // 2 reservations, 2 refunds, 0 net change.
    expect(m.user.updateMany.mock.calls.length).toBe(2);
    expect(decrementCalls.length).toBe(2);
  });
});
