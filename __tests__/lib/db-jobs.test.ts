/**
 * TM-161 — repository helpers for the background Job queue.
 *
 * Verifies behavior callers depend on:
 * - createJob JSON-encodes params (SQLite has no Json column).
 * - leaseJob is conditional: only the first racer transitions PENDING→RUNNING.
 * - completeJob / failJob / cancelJob clear the lease and set terminal status.
 * - requeueExpiredLeases distinguishes "retry available" from "out of attempts".
 *
 * We mock @/lib/db/prisma so this stays a fast unit test — actual DB shape
 * is exercised by `npx prisma db push` + the schema in the same PR.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    job: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import {
  createJob,
  leaseJob,
  completeJob,
  failJob,
  cancelJob,
  requeueExpiredLeases,
  decodeParams,
  JobStatus,
} from '@/lib/db/jobs';

const jobMock = (prisma as unknown as {
  job: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}).job;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createJob', () => {
  it('JSON-encodes params before persisting', async () => {
    jobMock.create.mockResolvedValue({ id: 'j1' });
    await createJob({
      userId: 'u1',
      kind: 'generate',
      prompt: 'hello',
      params: { answers: ['a', 'b'], opts: { x: 1 } },
    });
    const args = jobMock.create.mock.calls[0][0];
    expect(args.data.params).toBe('{"answers":["a","b"],"opts":{"x":1}}');
    expect(args.data.kind).toBe('generate');
  });

  it('persists null when params is omitted', async () => {
    jobMock.create.mockResolvedValue({ id: 'j2' });
    await createJob({ userId: 'u1', kind: 'generate', prompt: 'hi' });
    expect(jobMock.create.mock.calls[0][0].data.params).toBeNull();
  });
});

describe('decodeParams', () => {
  it('round-trips JSON objects', () => {
    expect(decodeParams('{"a":1}')).toEqual({ a: 1 });
  });
  it('rejects non-object JSON (array / scalar) and bad JSON', () => {
    expect(decodeParams('[1,2]')).toBeNull();
    expect(decodeParams('"x"')).toBeNull();
    expect(decodeParams('not json')).toBeNull();
    expect(decodeParams(null)).toBeNull();
  });
});

describe('leaseJob', () => {
  it('returns null when no PENDING rows exist', async () => {
    jobMock.findMany.mockResolvedValue([]);
    const claimed = await leaseJob();
    expect(claimed).toBeNull();
    expect(jobMock.updateMany).not.toHaveBeenCalled();
  });

  it('atomically claims via conditional updateMany (status=PENDING)', async () => {
    jobMock.findMany.mockResolvedValue([{ id: 'j1' }]);
    jobMock.updateMany.mockResolvedValueOnce({ count: 1 });
    jobMock.findUnique.mockResolvedValue({ id: 'j1', status: JobStatus.RUNNING });

    const claimed = await leaseJob({ ttlMs: 1000 });

    expect(claimed?.id).toBe('j1');
    const updateArgs = jobMock.updateMany.mock.calls[0][0];
    expect(updateArgs.where).toMatchObject({ id: 'j1', status: JobStatus.PENDING });
    expect(updateArgs.data.status).toBe(JobStatus.RUNNING);
    expect(updateArgs.data.attempts).toEqual({ increment: 1 });
    expect(updateArgs.data.leaseExpiresAt).toBeInstanceOf(Date);
  });

  it('falls through to the next candidate when it loses the race', async () => {
    jobMock.findMany.mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
    jobMock.updateMany
      .mockResolvedValueOnce({ count: 0 }) // lost race on j1
      .mockResolvedValueOnce({ count: 1 }); // got j2
    jobMock.findUnique.mockResolvedValue({ id: 'j2' });

    const claimed = await leaseJob();
    expect(claimed?.id).toBe('j2');
    expect(jobMock.updateMany).toHaveBeenCalledTimes(2);
  });

  it('filters by kind when provided', async () => {
    jobMock.findMany.mockResolvedValue([]);
    await leaseJob({ kind: 'generate' });
    expect(jobMock.findMany.mock.calls[0][0].where).toMatchObject({
      status: JobStatus.PENDING,
      kind: 'generate',
    });
  });
});

describe('terminal transitions', () => {
  it('completeJob sets SUCCEEDED and clears the lease', async () => {
    jobMock.update.mockResolvedValue({ id: 'j1', status: JobStatus.SUCCEEDED });
    await completeJob('j1', 'asset-123');
    const args = jobMock.update.mock.calls[0][0];
    expect(args.data).toMatchObject({
      status: JobStatus.SUCCEEDED,
      resultAssetId: 'asset-123',
      leasedAt: null,
      leaseExpiresAt: null,
      error: null,
    });
  });

  it('failJob truncates long error messages', async () => {
    jobMock.update.mockResolvedValue({ id: 'j1' });
    const longErr = 'x'.repeat(10_000);
    await failJob('j1', longErr);
    const args = jobMock.update.mock.calls[0][0];
    expect((args.data.error as string).length).toBe(4_000);
    expect(args.data.status).toBe(JobStatus.FAILED);
  });

  it('cancelJob sets CANCELLED', async () => {
    jobMock.update.mockResolvedValue({ id: 'j1' });
    await cancelJob('j1');
    expect(jobMock.update.mock.calls[0][0].data.status).toBe(JobStatus.CANCELLED);
  });
});

describe('requeueExpiredLeases', () => {
  it('fails rows past max attempts and requeues the rest', async () => {
    jobMock.updateMany
      .mockResolvedValueOnce({ count: 2 }) // failed branch
      .mockResolvedValueOnce({ count: 5 }); // requeue branch

    const res = await requeueExpiredLeases({ maxAttempts: 3 });

    expect(res).toEqual({ failed: 2, requeued: 5 });
    const failArgs = jobMock.updateMany.mock.calls[0][0];
    expect(failArgs.where.attempts).toEqual({ gte: 3 });
    expect(failArgs.data.status).toBe(JobStatus.FAILED);
    const requeueArgs = jobMock.updateMany.mock.calls[1][0];
    expect(requeueArgs.where.attempts).toEqual({ lt: 3 });
    expect(requeueArgs.data.status).toBe(JobStatus.PENDING);
  });
});
