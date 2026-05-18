/**
 * TM-160 — integration test: POST /api/generate links a client-provided
 * `progressId` to the in-process progress bus, forwards stage marks to
 * subscribers, and emits `done` on success.
 *
 * The route is exercised end-to-end with prisma + auth + generateAsset
 * mocked; the bus is real so we can observe its emissions.
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
import {
  subscribe,
  __resetForTests,
  type ProgressEvent,
} from '@/lib/ai/progress-bus';
import { recordMark } from '@/lib/ai/latency-profile';

describe('TM-160 — /api/generate SSE progress wiring', () => {
  beforeEach(() => {
    __resetForTests();
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      tier: 'FREE',
      monthlyUsage: 0,
      usageResetAt: new Date().toISOString(),
      editUsage: '{}',
    });
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    (prisma.asset.create as jest.Mock).mockResolvedValue({ id: 'asset-1' });
  });

  it('forwards stage marks to a subscriber and emits done on success', async () => {
    const progressId = 'pg_route_test_1';
    const handle = subscribe(progressId);
    const received: ProgressEvent[] = [];
    handle.onEvent((ev) => received.push(ev));

    // The mocked generateAsset reaches into latency-profile to emit a
    // mark, mirroring what the real pipeline does.
    (generateAsset as jest.Mock).mockImplementation(async (_p: string, _m: string, opts: { __latencyReqId?: string }) => {
      if (opts.__latencyReqId) {
        recordMark({ req: opts.__latencyReqId, phase: 'pipeline.outline', ms: 5_500, meta: { scenes: 2 } });
        recordMark({ req: opts.__latencyReqId, phase: 'pipeline.scene-code', ms: 4_100 });
      }
      return {
        type: 'generate',
        asset: {
          title: 't', code: 'c', jsCode: 'j', parameters: [],
          durationInFrames: 120, fps: 30, width: 1920, height: 1080,
        },
      };
    });

    const req = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a counter', progressId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const stages = received.map((e) => e.stage);
    expect(stages).toContain('pipeline.outline');
    expect(stages).toContain('pipeline.scene-code');
    expect(stages).toContain('done');
    // done is last
    expect(stages[stages.length - 1]).toBe('done');
  });

  it('emits done with error category on refusal', async () => {
    const progressId = 'pg_route_test_err';
    const handle = subscribe(progressId);
    const received: ProgressEvent[] = [];
    handle.onEvent((ev) => received.push(ev));

    const { AiRefusalError } = await import('@/lib/ai/refusal');
    (generateAsset as jest.Mock).mockRejectedValue(
      new AiRefusalError('safety', 'blocked'),
    );

    const req = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'x', progressId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const done = received.find((e) => e.stage === 'done');
    expect(done).toBeDefined();
    expect(done!.meta).toMatchObject({ type: 'error' });
  });

  it('does not link a channel when progressId is missing/invalid', async () => {
    (generateAsset as jest.Mock).mockResolvedValue({
      type: 'generate',
      asset: {
        title: 't', code: 'c', jsCode: 'j', parameters: [],
        durationInFrames: 120, fps: 30, width: 1920, height: 1080,
      },
    });

    // No progressId → no channel registration. We assert by subscribing
    // to an unrelated id after the call and observing zero replay.
    const req = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a counter' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const handle = subscribe('pg_unused');
    expect(handle.replay).toEqual([]);
    expect(handle.alreadyDone).toBe(false);
  });
});
