/**
 * TM-163 (ADR-0029 §3) — Background job worker.
 *
 * POST /api/jobs/process
 *   Leases the oldest PENDING Job (TM-161 helpers) and executes its
 *   payload. Currently handles `kind === 'generate'` by invoking the
 *   same `generateAsset` pipeline the synchronous /api/generate route
 *   uses, then writing the result Asset back via `completeJob`.
 *
 * Trigger strategy (hybrid, ADR-0029 §3):
 *   - Self-trigger: /api/generate?async=1 fires this endpoint
 *     fire-and-forget so dev / single-instance environments process
 *     jobs immediately. (TM-162 wiring.)
 *   - Vercel cron: a `*\/1 * * * *` cron hits this endpoint once a
 *     minute as a safety net (multi-instance, missed self-trigger,
 *     requeued lease). Wired in vercel.json.
 *
 * Auth:
 *   - NOT a user-facing endpoint. We accept either:
 *     (a) `Authorization: Bearer <CRON_SECRET>` — Vercel cron pattern,
 *     (b) `X-Internal: 1` from the same process (self-trigger),
 *     (c) DEV-only: no header required when NODE_ENV !== 'production'.
 *   - Any other call returns 401 so this can't be used to enumerate
 *     queue state or trigger spurious work.
 *
 * Idempotency / concurrency:
 *   - leaseJob() is CAS-atomic (TM-161). Two concurrent invocations
 *     simply claim two different rows (or one gets null).
 *   - On failure, `failJobWithRetry` either requeues (attempts < max)
 *     or fails terminally; the cron will eventually retry the
 *     requeued row. Quota is refunded only on terminal FAIL so a
 *     transient LLM blip doesn't double-charge.
 *
 * Per-request budget:
 *   - We lease at most ONE job per call. Worker invocations are
 *     cheap; processing 1-at-a-time keeps cold-start cost bounded
 *     and lets the cron schedule do the multiplexing. If queue
 *     depth grows we can crank this to N — see `MAX_JOBS_PER_CALL`.
 */
import { NextRequest, NextResponse } from 'next/server';
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
import { getModels } from '@/lib/ai/client';

export const runtime = 'nodejs';
// Vercel cron + Next.js: ensure we never cache this; we want the live
// queue state on every invocation.
export const dynamic = 'force-dynamic';

const MAX_JOBS_PER_CALL = 1;
const MAX_ATTEMPTS = 3;

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authz = req.headers.get('authorization');
  if (cronSecret && authz === `Bearer ${cronSecret}`) return true;
  if (req.headers.get('x-internal') === '1') return true;
  // Dev convenience: skip auth when no secret is configured AND we're
  // not in production. Production deployments MUST set CRON_SECRET.
  if (process.env.NODE_ENV !== 'production' && !cronSecret) return true;
  return false;
}

type ProcessSummary = {
  processed: number;
  succeeded: number;
  failed: number;
  requeued: number;
  expiredRecovered: number;
  details: Array<{
    jobId: string;
    kind: string;
    outcome: 'succeeded' | 'failed' | 'requeued' | 'refused';
    error?: string;
    durationMs: number;
  }>;
};

async function processOne(): Promise<ProcessSummary['details'][number] | null> {
  const job = await leaseJob({ ttlMs: 30 * 60 * 1000 }); // 30 min — generous for multi-step
  if (!job) return null;

  const start = Date.now();
  const params = decodeParams(job.params) ?? {};
  const tier = (params.tier as 'FREE' | 'PRO' | undefined) ?? 'FREE';
  const answers = params.answers as Record<string, string> | null | undefined;

  // Resolve model the same way the sync route does — keep behaviour identical.
  const models = getModels();
  const model = tier === 'PRO' ? models.pro : models.free;

  try {
    if (job.kind !== 'generate') {
      // Unknown kinds are treated as terminal failures — they should never
      // have been enqueued. Don't retry.
      const { job: jb } = await failJobWithRetry(job.id, `unknown job kind: ${job.kind}`, {
        currentAttempts: MAX_ATTEMPTS, // force terminal
        maxAttempts: MAX_ATTEMPTS,
      });
      return { jobId: jb.id, kind: job.kind, outcome: 'failed', error: 'unknown kind', durationMs: Date.now() - start };
    }

    const result = await generateAsset(job.prompt, model, { answers: answers ?? undefined });

    if (result.type === 'clarify') {
      // Clarify mid-async-flow is awkward — the client already submitted
      // their answers. Treat as terminal failure so the UI can re-prompt.
      // Refund quota since no asset was produced.
      await prisma.user.update({
        where: { id: job.userId },
        data: { monthlyUsage: { decrement: 1 } },
      });
      const { job: jb } = await failJobWithRetry(
        job.id,
        'clarification required mid-flight; resubmit with answers',
        { currentAttempts: MAX_ATTEMPTS, maxAttempts: MAX_ATTEMPTS },
      );
      return { jobId: jb.id, kind: job.kind, outcome: 'failed', error: 'clarify', durationMs: Date.now() - start };
    }

    const asset = result.asset;
    const dbAsset = await prisma.asset.create({
      data: {
        userId: job.userId,
        title: asset.title,
        code: asset.code,
        jsCode: asset.jsCode,
        parameters: JSON.stringify(asset.parameters),
        durationInFrames: asset.durationInFrames,
        fps: asset.fps,
        width: asset.width,
        height: asset.height,
        versions: {
          create: {
            code: asset.code,
            jsCode: asset.jsCode,
            parameters: JSON.stringify(asset.parameters),
            prompt: job.prompt,
          },
        },
      },
    });
    await completeJob(job.id, dbAsset.id);
    return {
      jobId: job.id,
      kind: job.kind,
      outcome: 'succeeded',
      durationMs: Date.now() - start,
    };
  } catch (error: unknown) {
    // Refusals are non-retryable (a retry would refuse again). Refund quota.
    if (error instanceof AiRefusalError) {
      await prisma.user.update({
        where: { id: job.userId },
        data: { monthlyUsage: { decrement: 1 } },
      });
      const { job: jb } = await failJobWithRetry(
        job.id,
        `refusal:${error.category}: ${error.message}`,
        { currentAttempts: MAX_ATTEMPTS, maxAttempts: MAX_ATTEMPTS }, // force terminal
      );
      return {
        jobId: jb.id,
        kind: job.kind,
        outcome: 'refused',
        error: error.category,
        durationMs: Date.now() - start,
      };
    }

    // Transient — let failJobWithRetry decide based on attempts.
    const msg = error instanceof Error ? error.message : String(error);
    const { requeued } = await failJobWithRetry(job.id, msg, {
      currentAttempts: job.attempts, // already incremented by leaseJob
      maxAttempts: MAX_ATTEMPTS,
    });
    if (!requeued) {
      // Terminal — refund quota (the sync path mirrors this; see route.ts ~L300).
      await prisma.user.update({
        where: { id: job.userId },
        data: { monthlyUsage: { decrement: 1 } },
      });
    }
    console.error(`[worker] job=${job.id} attempt=${job.attempts} ${requeued ? 'requeued' : 'failed'}:`, msg);
    return {
      jobId: job.id,
      kind: job.kind,
      outcome: requeued ? 'requeued' : 'failed',
      error: msg.slice(0, 200),
      durationMs: Date.now() - start,
    };
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Sweep expired leases first — cheap (one UPDATE), and recovers any rows
  // a previous crashed worker left in RUNNING. Without this, the cron is
  // our only recovery mechanism (60s lag) which is fine but redundant.
  const sweep = await requeueExpiredLeases({ maxAttempts: MAX_ATTEMPTS }).catch((e) => {
    console.error('[worker] requeueExpiredLeases failed:', e);
    return { requeued: 0, failed: 0 };
  });

  const summary: ProcessSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    requeued: 0,
    expiredRecovered: sweep.requeued,
    details: [],
  };

  for (let i = 0; i < MAX_JOBS_PER_CALL; i++) {
    const detail = await processOne();
    if (!detail) break;
    summary.processed += 1;
    summary.details.push(detail);
    if (detail.outcome === 'succeeded') summary.succeeded += 1;
    else if (detail.outcome === 'requeued') summary.requeued += 1;
    else summary.failed += 1; // failed | refused
  }

  return NextResponse.json(summary);
}

// Vercel cron POSTs by default, but allow GET so it can be hit manually for
// debugging (same auth gate applies). Cron config: see vercel.json.
export const GET = POST;
