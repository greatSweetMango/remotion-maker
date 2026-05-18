/**
 * TM-163 — POST /api/jobs/process worker endpoint.
 *
 * Covers:
 *   - Auth: rejects callers without CRON_SECRET / X-Internal in prod;
 *     dev-mode short-circuit when no secret is configured.
 *   - Happy path: lease → generateAsset → asset.create → completeJob.
 *   - Retry path: transient error with attempts < max → requeued, no
 *     quota refund.
 *   - Terminal path: refusal → terminal FAIL, quota refunded.
 *   - Empty queue: leaseJob returns null → 200 with processed=0.
 *   - Expired-lease sweep runs first (recovers crashed worker).
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { update: jest.fn() },
    asset: { create: jest.fn() },
  },
}));
jest.mock('@/lib/db/jobs', () => ({
  leaseJob: jest.fn(),
  completeJob: jest.fn(),
  failJobWithRetry: jest.fn(),
  decodeParams: jest.fn(),
  requeueExpiredLeases: jest.fn(),
  JobStatus: { PENDING: 'PENDING', RUNNING: 'RUNNING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' },
}));
jest.mock('@/lib/ai/generate', () => ({ generateAsset: jest.fn() }));
jest.mock('@/lib/ai/client', () => ({ getModels: () => ({ free: 'm-free', pro: 'm-pro' }) }));

import { prisma } from '@/lib/db/prisma';
import {
  leaseJob,
  completeJob,
  failJobWithRetry,
  decodeParams,
  requeueExpiredLeases,
} from '@/lib/db/jobs';
import { generateAsset } from '@/lib/ai/generate';
import { AiRefusalError } from '@/lib/ai/refusal';
import { POST } from '@/app/api/jobs/process/route';

const m = prisma as unknown as {
  user: { update: jest.Mock };
  asset: { create: jest.Mock };
};
const mLease = leaseJob as jest.MockedFunction<typeof leaseJob>;
const mComplete = completeJob as jest.MockedFunction<typeof completeJob>;
const mFail = failJobWithRetry as jest.MockedFunction<typeof failJobWithRetry>;
const mDecode = decodeParams as jest.MockedFunction<typeof decodeParams>;
const mRequeue = requeueExpiredLeases as jest.MockedFunction<typeof requeueExpiredLeases>;
const mGenerate = generateAsset as jest.MockedFunction<typeof generateAsset>;

const originalEnv = process.env;

function req(opts: { authz?: string; internal?: boolean } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.authz) headers['authorization'] = opts.authz;
  if (opts.internal) headers['x-internal'] = '1';
  return new NextRequest('http://localhost/api/jobs/process', { method: 'POST', headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv, NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv;
  mRequeue.mockResolvedValue({ requeued: 0, failed: 0 });
  mDecode.mockReturnValue({ tier: 'FREE', answers: null });
});

afterAll(() => {
  process.env = originalEnv;
});

describe('auth gate', () => {
  it('rejects without credentials in production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.CRON_SECRET = 'shh';
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mLease).not.toHaveBeenCalled();
  });

  it('accepts Bearer CRON_SECRET', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.CRON_SECRET = 'shh';
    mLease.mockResolvedValue(null);
    const res = await POST(req({ authz: 'Bearer shh' }));
    expect(res.status).toBe(200);
  });

  it('accepts X-Internal header from self-trigger', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.CRON_SECRET = 'shh';
    mLease.mockResolvedValue(null);
    const res = await POST(req({ internal: true }));
    expect(res.status).toBe(200);
  });

  it('dev mode without CRON_SECRET allows unauth calls', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    delete process.env.CRON_SECRET;
    mLease.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(200);
  });
});

describe('empty queue', () => {
  it('returns 200 with processed=0 when no PENDING jobs', async () => {
    mLease.mockResolvedValue(null);
    mRequeue.mockResolvedValue({ requeued: 2, failed: 0 });
    const res = await POST(req({ internal: true }));
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.expiredRecovered).toBe(2);
    expect(mGenerate).not.toHaveBeenCalled();
  });
});

describe('happy path', () => {
  it('leases → generates → writes asset → completeJob', async () => {
    mLease.mockResolvedValue({
      id: 'job-1', kind: 'generate', userId: 'u-1', prompt: 'a circle',
      params: '{}', attempts: 1, status: 'RUNNING',
    } as never);
    mGenerate.mockResolvedValue({
      type: 'generate',
      asset: {
        title: 't', code: 'c', jsCode: 'jc', parameters: [],
        durationInFrames: 60, fps: 30, width: 1920, height: 1080,
      },
    } as never);
    m.asset.create.mockResolvedValue({ id: 'asset-9' });

    const res = await POST(req({ internal: true }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.processed).toBe(1);
    expect(body.succeeded).toBe(1);
    expect(mComplete).toHaveBeenCalledWith('job-1', 'asset-9');
    expect(m.user.update).not.toHaveBeenCalled(); // no refund on success
  });

  it('uses pro model when tier=PRO in params', async () => {
    mLease.mockResolvedValue({
      id: 'j', kind: 'generate', userId: 'u', prompt: 'p', params: '{}', attempts: 1,
    } as never);
    mDecode.mockReturnValue({ tier: 'PRO', answers: null });
    mGenerate.mockResolvedValue({
      type: 'generate',
      asset: { title: 't', code: 'c', jsCode: 'jc', parameters: [], durationInFrames: 60, fps: 30, width: 1, height: 1 },
    } as never);
    m.asset.create.mockResolvedValue({ id: 'a' });
    await POST(req({ internal: true }));
    expect(mGenerate.mock.calls[0][1]).toBe('m-pro');
  });
});

describe('retry behaviour', () => {
  it('requeues on transient error without refunding quota', async () => {
    mLease.mockResolvedValue({
      id: 'job-2', kind: 'generate', userId: 'u-1', prompt: 'x', params: '{}', attempts: 1,
    } as never);
    mGenerate.mockRejectedValue(new Error('LLM timeout'));
    mFail.mockResolvedValue({ job: { id: 'job-2' } as never, requeued: true });

    const res = await POST(req({ internal: true }));
    const body = await res.json();
    expect(body.requeued).toBe(1);
    expect(body.failed).toBe(0);
    expect(m.user.update).not.toHaveBeenCalled(); // quota stays reserved
    expect(mFail).toHaveBeenCalledWith('job-2', 'LLM timeout', expect.objectContaining({
      currentAttempts: 1, maxAttempts: 3,
    }));
  });

  it('refunds quota on terminal failure (max attempts hit)', async () => {
    mLease.mockResolvedValue({
      id: 'job-3', kind: 'generate', userId: 'u-1', prompt: 'x', params: '{}', attempts: 3,
    } as never);
    mGenerate.mockRejectedValue(new Error('still broken'));
    mFail.mockResolvedValue({ job: { id: 'job-3' } as never, requeued: false });

    await POST(req({ internal: true }));
    expect(m.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u-1' },
      data: { monthlyUsage: { decrement: 1 } },
    }));
  });
});

describe('refusal handling', () => {
  it('terminally fails AND refunds quota on AiRefusalError', async () => {
    mLease.mockResolvedValue({
      id: 'job-4', kind: 'generate', userId: 'u-1', prompt: 'bad', params: '{}', attempts: 1,
    } as never);
    mGenerate.mockRejectedValue(new AiRefusalError({ category: 'safety' as never, matchedHint: 'h' }));
    mFail.mockResolvedValue({ job: { id: 'job-4' } as never, requeued: false });

    const res = await POST(req({ internal: true }));
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(m.user.update).toHaveBeenCalled();
    // Forced terminal — currentAttempts=maxAttempts
    expect(mFail.mock.calls[0][2]).toMatchObject({ currentAttempts: 3, maxAttempts: 3 });
  });
});

describe('clarify mid-flight', () => {
  it('is treated as terminal failure + quota refund', async () => {
    mLease.mockResolvedValue({
      id: 'job-5', kind: 'generate', userId: 'u-1', prompt: 'x', params: '{}', attempts: 1,
    } as never);
    mGenerate.mockResolvedValue({ type: 'clarify', questions: ['?'] } as never);
    mFail.mockResolvedValue({ job: { id: 'job-5' } as never, requeued: false });

    const res = await POST(req({ internal: true }));
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(m.user.update).toHaveBeenCalled();
  });
});
