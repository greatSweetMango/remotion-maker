import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { AiRefusalError } from '@/lib/ai/refusal';
import { getModels } from '@/lib/ai/client';
import { TIER_LIMITS } from '@/lib/usage';
import { validatePrompt } from '@/lib/validation/prompt';
import { newRequestId, recordMark, isLatencyProfileEnabled } from '@/lib/ai/latency-profile';

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
  const { prompt, answers } = body as { prompt?: string; answers?: Record<string, string> };
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
    return resp;
  } catch (error: unknown) {
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
