import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { AiRefusalError } from '@/lib/ai/refusal';
import { getModels } from '@/lib/ai/client';
import { TIER_LIMITS } from '@/lib/usage';
import { validatePrompt } from '@/lib/validation/prompt';
import { newRequestId, recordMark, isLatencyProfileEnabled } from '@/lib/ai/latency-profile';
import {
  ensureChannel,
  linkRequestToProgress,
  unlinkRequest,
  complete as completeProgress,
} from '@/lib/ai/progress-bus';
import { createJob } from '@/lib/db/jobs';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // TM-156 — wall-clock anchors for every phase boundary in the route. The
  // marks are no-ops unless LATENCY_PROFILE=1, so prod stays clean. The id
  // is echoed in the response header `x-tm156-req` so bench drivers can
  // cross-reference HTTP timing with server-side stage breakdown.
  const reqId = newRequestId();
  const t0 = Date.now();
  const profileEnabled = isLatencyProfileEnabled();

  const authStart = Date.now();
  const session = await auth();
  recordMark({ req: reqId, phase: 'route.auth', ms: Date.now() - authStart });
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate input shape BEFORE any DB / quota work. TM-58 length cap.
  const bodyStart = Date.now();
  const body = await req.json();
  recordMark({ req: reqId, phase: 'route.body-parse', ms: Date.now() - bodyStart });
  const { prompt, answers, progressId, async: bodyAsync } = body as {
    prompt?: string;
    answers?: Record<string, string>;
    // TM-160 — optional client-generated id used to fan stage marks to a
    // companion SSE subscriber (`/api/generate/progress?id=<progressId>`).
    // When omitted, behaviour is unchanged (timer fallback applies).
    progressId?: string;
    // TM-162 (ADR-0029 §2) — opt-in async mode. When truthy (or `?async=1`
    // query), the handler creates a PENDING Job row and returns 202 with
    // `{ jobId, statusUrl }` instead of running asset-gen synchronously.
    async?: unknown;
  };
  // TM-162 — async flag (query or body). Query wins (URL is the canonical
  // place for "switch handler mode" in REST).
  const url = new URL(req.url);
  const asyncQuery = url.searchParams.get('async');
  const asyncMode =
    asyncQuery === '1' || asyncQuery === 'true' || bodyAsync === true || bodyAsync === 1 || bodyAsync === '1';
  if (typeof progressId === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(progressId)) {
    ensureChannel(progressId);
    linkRequestToProgress(reqId, progressId);
  }
  const promptError = validatePrompt(prompt);
  if (promptError || typeof prompt !== 'string') {
    const err = promptError ?? { message: 'Prompt required', code: 'PROMPT_REQUIRED' as const, status: 400 as const };
    return NextResponse.json(
      { error: err.message, code: err.code, ...((promptError?.meta) ?? {}) },
      { status: err.status },
    );
  }

  const userLookupStart = Date.now();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  recordMark({ req: reqId, phase: 'route.user-lookup', ms: Date.now() - userLookupStart });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const now = new Date();
  const resetAt = new Date(user.usageResetAt);
  if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: 0, usageResetAt: now, editUsage: '{}' },
    });
    user.monthlyUsage = 0;
  }

  // TM-92 — atomically reserve a quota slot BEFORE the LLM call.
  //
  // Previously this route did `findUnique → in-memory compare → generateAsset → update`,
  // which is a TOCTOU race: N concurrent FREE requests at usage=0 all read 0, all
  // pass the gate, all increment to N. SQLite + Prisma do not serialize this.
  //
  // The fix is a single conditional `updateMany` whose `where` includes the cap.
  // SQLite executes this as one atomic statement, so exactly `limit - usage` of
  // the burst will see `count: 1`; the rest see `count: 0` and are rejected.
  // Refunds happen on the no-charge paths (clarify, refusal) below.
  const limit = TIER_LIMITS[user.tier].monthlyGenerations;
  const reserveStart = Date.now();
  const reserved = await prisma.user.updateMany({
    where: { id: user.id, monthlyUsage: { lt: limit } },
    data: { monthlyUsage: { increment: 1 } },
  });
  recordMark({ req: reqId, phase: 'route.quota-reserve', ms: Date.now() - reserveStart });
  if (reserved.count === 0) {
    return NextResponse.json(
      {
        error: `Monthly generation limit reached (${limit}). ${
          user.tier === 'FREE' ? 'Upgrade to Pro for 200/month.' : 'Purchase additional credits.'
        }`,
      },
      { status: 429 },
    );
  }

  // TM-162 (ADR-0029 §2) — async mode short-circuit.
  //
  // After auth + prompt validation + quota reservation succeed, persist
  // the request as a PENDING Job and return 202 immediately. The actual
  // generation runs in a worker (TM-163) which leases the row, executes
  // the existing pipeline, and writes the asset back via completeJob().
  //
  // Quota: we keep the slot reserved (the synchronous path already
  // reserves before LLM call); the worker is responsible for refunding
  // on clarify / refusal / failure outcomes — same accounting as the
  // sync branch below. The endpoint, in other words, only changes WHEN
  // the work happens, never WHETHER quota is charged.
  if (asyncMode) {
    try {
      const job = await createJob({
        userId: user.id,
        kind: 'generate',
        prompt,
        params: { answers: answers ?? null, tier: user.tier, progressId: progressId ?? null },
      });
      recordMark({ req: reqId, phase: 'route.async-enqueue', ms: Date.now() - t0, meta: { jobId: job.id } });
      const resp = NextResponse.json(
        { jobId: job.id, statusUrl: `/api/jobs/${job.id}`, status: job.status },
        { status: 202 },
      );
      if (profileEnabled) resp.headers.set('x-tm156-req', reqId);
      // No SSE/progress fan-out here — the worker owns that lifecycle.
      if (progressId) unlinkRequest(reqId);
      return resp;
    } catch (e) {
      // Enqueue failed — refund the reserved quota slot so the user isn't
      // charged for a job that never existed.
      await prisma.user.update({
        where: { id: user.id },
        data: { monthlyUsage: { decrement: 1 } },
      });
      console.error('[generate] async enqueue failed:', e);
      return NextResponse.json({ error: 'Failed to enqueue job' }, { status: 500 });
    }
  }

  const models = getModels();
  const model = user.tier === 'PRO' ? models.pro : models.free;
  console.log(`[generate] tier=${user.tier} model=${model} usage=${user.monthlyUsage}`);

  try {
    const generateStart = Date.now();
    let firstTokenMs = -1;
    const result = await generateAsset(prompt, model, {
      answers,
      onFirstToken: (ms) => {
        firstTokenMs = ms;
        // TM-54 — first-byte observability for the route. Helps correlate
        // server-side TTFB with client-perceived latency (acceptance: p50 ≤ 5s).
        console.log(`[generate] firstTokenMs=${ms} model=${model} tier=${user.tier}`);
      },
      // TM-156 — propagate the request id so generateAsset's internal marks
      // tie back to this route's reqId.
      __latencyReqId: reqId,
    });
    const totalMs = Date.now() - generateStart;
    recordMark({ req: reqId, phase: 'route.generateAsset', ms: totalMs, meta: { firstTokenMs, type: result.type } });
    console.log(
      `[generate] done totalMs=${totalMs} firstTokenMs=${firstTokenMs} type=${result.type}`,
    );
    // TM-124 — when the single-shot path executed (multi-step not enabled or
    // clarify/answers branch), synthesize a single-stage timing trace so the
    // UI dev badge can still distinguish modes. Multi-step responses arrive
    // with `assetGenStages` already populated by the pipeline.
    //
    // TM-136 — surface `asset_gen_used: true` whenever the single-shot path
    // produced a PNG (the previous hardcoded `false` predates the TM-136 fix
    // and would mask the new behaviour from the dev badge / telemetry).
    const resultWithStages = result as typeof result & {
      assetGenStages?: import('@/lib/ai/pipeline').PipelineTiming;
      assetGen?: import('@/lib/ai/asset-gen-stage').AssetGenStageResult;
    };
    if (!resultWithStages.assetGenStages && result.type === 'generate') {
      const assetGenUsed = !!resultWithStages.assetGen;
      resultWithStages.assetGenStages = {
        mode: 'single-shot',
        stages: [{
          name: 'single-shot',
          ms: totalMs,
          meta: {
            firstTokenMs: firstTokenMs >= 0 ? firstTokenMs : -1,
            ...(assetGenUsed
              ? {
                  assetGenCached: resultWithStages.assetGen!.cached,
                  assetGenLatencyMs: resultWithStages.assetGen!.latencyMs,
                  assetGenCostUsd: resultWithStages.assetGen!.costUsd,
                }
              : {}),
          },
        }],
        totalMs,
        asset_gen_used: assetGenUsed,
        scenes: 0,
      };
    }

    // Clarify-only response: do NOT consume monthly quota. We already reserved
    // a slot above; refund it here so clarify rounds remain free.
    if (result.type === 'clarify') {
      await prisma.user.update({
        where: { id: user.id },
        data: { monthlyUsage: { decrement: 1 } },
      });
      if (progressId) {
        completeProgress(progressId, { type: 'clarify' });
        unlinkRequest(reqId);
      }
      return NextResponse.json({ type: 'clarify', questions: result.questions });
    }

    const asset = result.asset;

    const dbWriteStart = Date.now();
    const dbAsset = await prisma.asset.create({
      data: {
        userId: user.id,
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
            prompt,
          },
        },
      },
    });

    recordMark({ req: reqId, phase: 'route.db-write', ms: Date.now() - dbWriteStart, meta: { codeLen: asset.code?.length ?? 0 } });

    // Quota was already reserved before generation — no second increment here.
    // TM-100: pass through `warning` (set when fallback template was used) so
    // the UI can surface a non-fatal toast asking the user to refine the prompt.
    const totalRouteMs = Date.now() - t0;
    recordMark({ req: reqId, phase: 'route.total', ms: totalRouteMs, meta: { type: result.type } });
    const resp = NextResponse.json({
      type: 'generate',
      asset: { ...asset, id: dbAsset.id },
      ...(result.warning ? { warning: result.warning } : {}),
      ...(resultWithStages.assetGenStages ? { assetGenStages: resultWithStages.assetGenStages } : {}),
      // TM-150 — surface TM-138 self-critique judge metadata when present so
      // clients + QA harnesses can verify the loop actually ran (score,
      // retried, threshold, per-attempt ms) without grepping server logs.
      ...((result as typeof result & { selfCritique?: import('@/types').SelfCritiqueMetadata }).selfCritique
        ? { selfCritique: (result as typeof result & { selfCritique?: import('@/types').SelfCritiqueMetadata }).selfCritique }
        : {}),
    });
    if (profileEnabled) resp.headers.set('x-tm156-req', reqId);
    // TM-160 — fire SSE done event so the subscriber closes promptly.
    if (progressId) {
      completeProgress(progressId, { type: 'generate', totalMs: totalRouteMs });
      unlinkRequest(reqId);
    }
    return resp;
  } catch (error: unknown) {
    // TM-160 — always close the progress channel on failure so the
    // subscriber doesn't hang. Meta carries the error category for the UI.
    if (progressId) {
      const cat =
        error instanceof AiRefusalError ? error.category : 'error';
      completeProgress(progressId, {
        type: 'error',
        category: cat,
        message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      });
      unlinkRequest(reqId);
    }
    // TM-59 — adversarial / safety / policy refusals surface as 400 with a
    // category code so the UI can show a clearer toast. We do NOT consume
    // monthly quota for these (no asset was created above this point), so
    // refund the slot reserved at the top of the handler.
    if (error instanceof AiRefusalError) {
      await prisma.user.update({
        where: { id: user.id },
        data: { monthlyUsage: { decrement: 1 } },
      });
      console.warn(
        `[generate] refusal category=${error.category} hint=${error.matchedHint ?? '-'} tier=${user.tier}`,
      );
      return NextResponse.json(
        { error: error.message, code: error.code, category: error.category },
        { status: 400 },
      );
    }
    // Unexpected failure: also refund so a 500 doesn't burn the user's quota.
    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: { decrement: 1 } },
    });
    console.error('Generation error:', error);
    const msg = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
