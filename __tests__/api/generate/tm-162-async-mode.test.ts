/**
 * TM-162 (ADR-0029 §2) — async mode for POST /api/generate.
 *
 * Verifies the new contract:
 *   - `?async=1` (query) or `{ async: true }` (body) returns 202 with
 *     `{ jobId, statusUrl, status: 'PENDING' }` and does NOT invoke
 *     the LLM (generateAsset).
 *   - Auth gate runs before async branching (401 takes priority).
 *   - Quota gate runs before async branching (429 takes priority — we
 *     never enqueue a job for an over-quota user).
 *   - Default (no flag) keeps the sync path unchanged.
 *   - createJob receives prompt + answers + tier so the worker has
 *     everything it needs.
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
jest.mock('@/lib/ai/client', () => ({ getModels: () => ({ free: 'm-free', pro: 'm-pro' }) }));
jest.mock('@/lib/db/jobs', () => ({ createJob: jest.fn() }));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { createJob } from '@/lib/db/jobs';
import { POST } from '@/app/api/generate/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedGenerate = generateAsset as jest.MockedFunction<typeof generateAsset>;
const mockedCreateJob = createJob as jest.MockedFunction<typeof createJob>;
const m = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  asset: { create: jest.Mock };
};

function req(opts: { async?: 'query' | 'body' | 'none'; body?: Record<string, unknown> } = {}): NextRequest {
  const qs = opts.async === 'query' ? '?async=1' : '';
  const bodyObj = { prompt: 'make a blue circle', ...(opts.body ?? {}) };
  if (opts.async === 'body') (bodyObj as Record<string, unknown>).async = true;
  return new NextRequest(`http://localhost/api/generate${qs}`, {
    method: 'POST',
    body: JSON.stringify(bodyObj),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
  m.user.findUnique.mockResolvedValue({
    id: 'u-1', tier: 'FREE', monthlyUsage: 0, usageResetAt: new Date(), editUsage: '{}',
  });
  m.user.updateMany.mockResolvedValue({ count: 1 });
  m.user.update.mockResolvedValue({});
});

describe('POST /api/generate — TM-162 async mode', () => {
  it('returns 202 with jobId/statusUrl when ?async=1 (query)', async () => {
    mockedCreateJob.mockResolvedValue({ id: 'job-abc', status: 'PENDING' } as never);
    const res = await POST(req({ async: 'query' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ jobId: 'job-abc', statusUrl: '/api/jobs/job-abc', status: 'PENDING' });
    expect(mockedGenerate).not.toHaveBeenCalled();
    expect(mockedCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', kind: 'generate', prompt: 'make a blue circle' }),
    );
  });

  it('returns 202 when body.async === true', async () => {
    mockedCreateJob.mockResolvedValue({ id: 'job-xyz', status: 'PENDING' } as never);
    const res = await POST(req({ async: 'body' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toBe('job-xyz');
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it('persists answers + tier in job params (worker needs them)', async () => {
    mockedCreateJob.mockResolvedValue({ id: 'j-1', status: 'PENDING' } as never);
    await POST(req({ async: 'query', body: { answers: { q1: 'red' } } }));
    const call = mockedCreateJob.mock.calls[0][0];
    expect(call.params).toMatchObject({ answers: { q1: 'red' }, tier: 'FREE' });
  });

  it('keeps sync path unchanged when no async flag', async () => {
    mockedGenerate.mockResolvedValue({
      type: 'generate',
      asset: {
        title: 't', code: 'c', jsCode: 'jc', parameters: [],
        durationInFrames: 60, fps: 30, width: 1920, height: 1080,
      },
    } as never);
    m.asset.create.mockResolvedValue({ id: 'a-1' });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockedCreateJob).not.toHaveBeenCalled();
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthenticated requests before any DB work (401)', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const res = await POST(req({ async: 'query' }));
    expect(res.status).toBe(401);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it('rejects async requests over quota (429) without enqueuing', async () => {
    m.user.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(req({ async: 'query' }));
    expect(res.status).toBe(429);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it('refunds quota if createJob throws', async () => {
    mockedCreateJob.mockRejectedValue(new Error('db down'));
    const res = await POST(req({ async: 'query' }));
    expect(res.status).toBe(500);
    // refund: monthlyUsage decrement issued
    expect(m.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyUsage: { decrement: 1 } } }),
    );
  });
});
