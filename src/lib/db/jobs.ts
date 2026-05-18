/**
 * TM-161 — Job repository helpers (ADR-0029 §1).
 *
 * Wraps the Prisma `Job` model with a small, opinionated API for the
 * background asset-generation pipeline. Keep DB shape concerns (JSON
 * encoding of `params`, lease atomicity, attempt accounting) in this
 * one module so callers (route handlers, workers, the in-process poller)
 * never touch raw columns.
 *
 * Why a helper instead of bare prisma calls:
 * - `params` is `String?` on SQLite (no Json type); centralize JSON encode/decode
 *   so a missing-stringify bug can't leak into multiple callers.
 * - `leaseJob` needs to be atomic. SQLite has no `SELECT … FOR UPDATE`, so we
 *   use a conditional `updateMany({ where: { id, status: PENDING } })` and
 *   re-fetch only when the row count == 1. That is the same pattern
 *   Prisma docs recommend for opportunistic locking on engines without
 *   row locks (works on Postgres too — Postgres just has a stronger guarantee).
 * - `requeueExpiredLeases` is a no-op until a worker exists, but lives here so
 *   the contract is testable today (TM-161 D verify).
 */
import { prisma } from '@/lib/db/prisma';
import { JobStatus, type Job, type Prisma } from '@prisma/client';

export { JobStatus };
export type { Job };

export type JobParams = Record<string, unknown>;

export type CreateJobInput = {
  userId: string;
  kind: string;
  prompt: string;
  params?: JobParams | null;
};

/** Default lease TTL — generous enough for clarify+asset-gen+first render. */
export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000; // 5 min

function encodeParams(params: JobParams | null | undefined): string | null {
  if (params == null) return null;
  return JSON.stringify(params);
}

export function decodeParams(raw: string | null | undefined): JobParams | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JobParams;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  return prisma.job.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      prompt: input.prompt,
      params: encodeParams(input.params ?? null),
    },
  });
}

export async function getJob(id: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id } });
}

export type ListJobsFilter = {
  userId?: string;
  status?: JobStatus | JobStatus[];
  take?: number;
};

export async function listJobs(filter: ListJobsFilter = {}): Promise<Job[]> {
  const where: Prisma.JobWhereInput = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.status) {
    where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
  }
  return prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filter.take ?? 50,
  });
}

/**
 * Atomically claim the oldest PENDING job (optionally filtered by `kind`).
 * Returns the claimed Job, or null if nothing was available.
 *
 * Implementation: peek-then-CAS-update. The `updateMany` with both `id` and
 * `status: PENDING` in the WHERE clause makes the transition atomic — if two
 * workers race, only one sees `count === 1`.
 */
export async function leaseJob(opts: {
  kind?: string;
  ttlMs?: number;
} = {}): Promise<Job | null> {
  const ttl = opts.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  // Peek the oldest candidate. Slight over-fetch (5) so concurrent workers
  // can each grab a different row instead of all colliding on row #1.
  const candidates = await prisma.job.findMany({
    where: { status: JobStatus.PENDING, ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + ttl);
  for (const candidate of candidates) {
    const res = await prisma.job.updateMany({
      where: { id: candidate.id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        leasedAt: now,
        leaseExpiresAt: leaseExpires,
        attempts: { increment: 1 },
      },
    });
    if (res.count === 1) {
      return prisma.job.findUnique({ where: { id: candidate.id } });
    }
    // Lost the race — try the next candidate.
  }
  return null;
}

export async function completeJob(id: string, resultAssetId: string): Promise<Job> {
  return prisma.job.update({
    where: { id },
    data: {
      status: JobStatus.SUCCEEDED,
      resultAssetId,
      error: null,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });
}

export async function failJob(id: string, error: string): Promise<Job> {
  // Truncate so a runaway stack trace cannot blow up the row.
  const message = error.length > 4_000 ? error.slice(0, 4_000) : error;
  return prisma.job.update({
    where: { id },
    data: {
      status: JobStatus.FAILED,
      error: message,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });
}

/**
 * TM-163 — worker-side failure handler with attempt-aware retry.
 *
 * Behaviour:
 *   - If `currentAttempts < maxAttempts`: requeue back to PENDING (the worker
 *     or cron will lease it again later). `error` is stamped so polling clients
 *     can see *why* the last attempt failed without losing the retry.
 *   - Otherwise: terminal FAILED with the error message.
 *
 * Why a separate function (vs. extending `failJob`):
 *   - `failJob` is the unambiguous "give up" path; some callers (refusals,
 *     validation errors, cancellations) MUST NOT retry. Keeping the API
 *     bifurcated prevents an accidental retry of a non-retryable failure.
 *   - The worker is the only caller that knows the request was transient
 *     (e.g. LLM timeout) vs. permanent (e.g. refusal).
 */
export async function failJobWithRetry(
  id: string,
  error: string,
  opts: { currentAttempts: number; maxAttempts?: number } = { currentAttempts: 1 },
): Promise<{ job: Job; requeued: boolean }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const message = error.length > 4_000 ? error.slice(0, 4_000) : error;
  if (opts.currentAttempts < maxAttempts) {
    const job = await prisma.job.update({
      where: { id },
      data: {
        status: JobStatus.PENDING,
        error: message, // surface last error to client even while retrying
        leasedAt: null,
        leaseExpiresAt: null,
      },
    });
    return { job, requeued: true };
  }
  const job = await prisma.job.update({
    where: { id },
    data: {
      status: JobStatus.FAILED,
      error: message,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });
  return { job, requeued: false };
}

export async function cancelJob(id: string): Promise<Job> {
  return prisma.job.update({
    where: { id },
    data: { status: JobStatus.CANCELLED, leasedAt: null, leaseExpiresAt: null },
  });
}

/**
 * Reset RUNNING jobs whose lease has expired back to PENDING so another
 * worker can pick them up. Returns the number of rows requeued.
 *
 * Cap `maxAttempts` so a perpetually crashing job eventually FAILs instead
 * of looping forever. attempts is incremented on every lease; once it
 * reaches the cap the row goes to FAILED with a synthetic error.
 */
export async function requeueExpiredLeases(opts: { maxAttempts?: number } = {}): Promise<{
  requeued: number;
  failed: number;
}> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const now = new Date();

  const failedRes = await prisma.job.updateMany({
    where: {
      status: JobStatus.RUNNING,
      leaseExpiresAt: { lt: now },
      attempts: { gte: maxAttempts },
    },
    data: {
      status: JobStatus.FAILED,
      error: `lease expired after ${maxAttempts} attempts`,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });

  const requeueRes = await prisma.job.updateMany({
    where: {
      status: JobStatus.RUNNING,
      leaseExpiresAt: { lt: now },
      attempts: { lt: maxAttempts },
    },
    data: {
      status: JobStatus.PENDING,
      leasedAt: null,
      leaseExpiresAt: null,
    },
  });

  return { requeued: requeueRes.count, failed: failedRes.count };
}
