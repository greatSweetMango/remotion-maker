/**
 * TM-162 (ADR-0029 §2) — Job status endpoint.
 *
 * GET /api/jobs/[id]
 *   - Returns the lifecycle row for an async job submitted via
 *     `POST /api/generate?async=1`. The client polls this until the job
 *     reaches a terminal state (SUCCEEDED / FAILED / CANCELLED). SSE
 *     upgrade is a separate concern (ADR-0029, deferred).
 *
 * Auth: required. Owner-scoped — a job's owner is the only caller
 * allowed to read it. Mismatched owners get 404 (not 403) so the
 * endpoint does not leak the existence of jobs across users.
 *
 * Shape:
 *   {
 *     id, status, kind, attempts, error, createdAt, updatedAt,
 *     resultAssetId, resultAsset?  // included on SUCCEEDED
 *   }
 *
 * Result asset: on SUCCEEDED we eagerly include the full asset record
 * (same shape the synchronous /api/generate returns under
 * `asset.id+code+jsCode+parameters+...`). This saves the client a
 * second round-trip after polling resolves.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { getJob, JobStatus } from '@/lib/db/jobs';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const job = await getJob(id);
  if (!job || job.userId !== session.user.id) {
    // 404 even on owner mismatch — see file header.
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const base = {
    id: job.id,
    status: job.status,
    kind: job.kind,
    attempts: job.attempts,
    error: job.error,
    resultAssetId: job.resultAssetId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };

  if (job.status === JobStatus.SUCCEEDED && job.resultAssetId) {
    const asset = await prisma.asset.findUnique({ where: { id: job.resultAssetId } });
    if (asset) {
      return NextResponse.json({
        ...base,
        resultAsset: {
          id: asset.id,
          title: asset.title,
          code: asset.code,
          jsCode: asset.jsCode,
          parameters: asset.parameters, // JSON-encoded string (matches /api/asset/[id])
          durationInFrames: asset.durationInFrames,
          fps: asset.fps,
          width: asset.width,
          height: asset.height,
        },
      });
    }
  }

  return NextResponse.json(base);
}
