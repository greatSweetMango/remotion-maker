/**
 * TM-162 (ADR-0029 §2) — GET /api/jobs/[id] status endpoint.
 *
 * Validates:
 *   - 401 when unauthenticated.
 *   - 404 when the job doesn't exist OR the owner doesn't match
 *     (no leak of cross-user job existence).
 *   - PENDING/RUNNING/FAILED responses return base fields only.
 *   - SUCCEEDED includes the eagerly-loaded `resultAsset` so the
 *     client doesn't need a second round-trip.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db/prisma', () => ({
  prisma: { asset: { findUnique: jest.fn() } },
}));
jest.mock('@/lib/db/jobs', () => ({
  getJob: jest.fn(),
  JobStatus: {
    PENDING: 'PENDING', RUNNING: 'RUNNING', SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED', CANCELLED: 'CANCELLED',
  },
}));

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { getJob } from '@/lib/db/jobs';
import { GET } from '@/app/api/jobs/[id]/route';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
type SessionShape = ReturnType<typeof auth> extends Promise<infer R> ? R : never;
const mockedGetJob = getJob as jest.MockedFunction<typeof getJob>;
const m = prisma as unknown as { asset: { findUnique: jest.Mock } };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new NextRequest('http://localhost/api/jobs/x');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue({ user: { id: 'u-1' } } as unknown as SessionShape);
});

describe('GET /api/jobs/[id] — TM-162 status', () => {
  it('401 unauthenticated', async () => {
    mockedAuth.mockResolvedValue(null as unknown as SessionShape);
    const res = await GET(req(), ctx('j-1'));
    expect(res.status).toBe(401);
  });

  it('404 when job does not exist', async () => {
    mockedGetJob.mockResolvedValue(null);
    const res = await GET(req(), ctx('j-missing'));
    expect(res.status).toBe(404);
  });

  it('404 when caller is not the owner (no cross-user leak)', async () => {
    mockedGetJob.mockResolvedValue({
      id: 'j-1', userId: 'u-OTHER', status: 'PENDING', kind: 'generate',
      attempts: 0, error: null, resultAssetId: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const res = await GET(req(), ctx('j-1'));
    expect(res.status).toBe(404);
  });

  it('returns base fields for PENDING', async () => {
    const now = new Date();
    mockedGetJob.mockResolvedValue({
      id: 'j-1', userId: 'u-1', status: 'PENDING', kind: 'generate',
      attempts: 0, error: null, resultAssetId: null,
      createdAt: now, updatedAt: now,
    } as never);
    const res = await GET(req(), ctx('j-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'j-1', status: 'PENDING', kind: 'generate', attempts: 0 });
    expect(body.resultAsset).toBeUndefined();
    expect(m.asset.findUnique).not.toHaveBeenCalled();
  });

  it('returns error for FAILED', async () => {
    mockedGetJob.mockResolvedValue({
      id: 'j-2', userId: 'u-1', status: 'FAILED', kind: 'generate',
      attempts: 3, error: 'lease expired', resultAssetId: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const res = await GET(req(), ctx('j-2'));
    const body = await res.json();
    expect(body.status).toBe('FAILED');
    expect(body.error).toBe('lease expired');
  });

  it('eagerly loads resultAsset on SUCCEEDED', async () => {
    mockedGetJob.mockResolvedValue({
      id: 'j-3', userId: 'u-1', status: 'SUCCEEDED', kind: 'generate',
      attempts: 1, error: null, resultAssetId: 'a-1',
      createdAt: new Date(), updatedAt: new Date(),
    } as never);
    m.asset.findUnique.mockResolvedValue({
      id: 'a-1', title: 'Blue Circle', code: 'export const C=...', jsCode: 'jc',
      parameters: '[]', durationInFrames: 60, fps: 30, width: 1920, height: 1080,
    });
    const res = await GET(req(), ctx('j-3'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('SUCCEEDED');
    expect(body.resultAssetId).toBe('a-1');
    expect(body.resultAsset).toMatchObject({
      id: 'a-1', title: 'Blue Circle', durationInFrames: 60, fps: 30,
    });
  });
});
