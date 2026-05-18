/**
 * POST /api/generate/prefetch — TM-157 speculative asset-gen prefetch.
 *
 * Background: TM-156 RCA found gpt-image-1 wire-time is ~34s of a ~41s
 * character-prompt generate. The clarify dialog asks the user 3-5 questions
 * which typically take 5-15s to answer. That idle window is wasted — by
 * the time the user clicks submit, asset-gen has not even started.
 *
 * This endpoint lets the client fire a speculative `runAssetGenStage` the
 * MOMENT the clarify dialog appears, using the *default* answers (first
 * choice of each question). The disk-keyed sha256 cache in asset-gen-stage
 * is the load-bearing piece: when the user later submits real answers via
 * `/api/generate`, the pipeline computes the same hash and short-circuits
 * to the on-disk PNG (cached:true, 0ms, $0).
 *
 * Cost behaviour:
 *  - Cache hit (user accepted defaults): user pays $0.04 ONCE for asset-gen.
 *    Wall-clock saved: ~34s of overlap with clarify answer time.
 *  - Cache miss (user picked non-defaults): we still spent $0.04 on the
 *    speculative call. The PNG lands on disk under its (default-answers)
 *    hash and silently helps the NEXT user who accepts defaults. The
 *    in-flight user pays a second $0.04 + waits the full 34s.
 *
 *  Net expected savings depend on default-acceptance rate. Per the TM-157
 *  task brief, even a 30% acceptance rate yields ~25% p50 latency cut on
 *  character prompts. ADR-0022 follow-up will tune this if waste outpaces
 *  savings.
 *
 * Hard guards (cost):
 *  1. Auth required (same as /api/generate).
 *  2. `detectLivingEntity(prompt, defaultAnswers)` MUST match — non-character
 *     prompts skip asset-gen entirely in the main pipeline (TM-90), so a
 *     prefetch would be 100% waste.
 *  3. No quota touched. The main pipeline accounts the cost when it consumes
 *     the cached PNG. The prefetch deliberately operates outside the monthly
 *     limit — speculative work that lands on disk is amortised across users.
 *  4. `OPENAI_API_KEY` required (fail-loud 503 otherwise).
 *
 * Concurrency: identical prefetches within a single Node process collapse
 * via `inMemoryHashCache` (TM-90 short-circuit) — back-to-back POSTs from
 * the same client (React strict-mode double-effect, or burst from multiple
 * tabs) do not double-charge.
 *
 * Fire-and-forget contract: the client SHOULD NOT await this response. We
 * still return 200 with a small status payload for tests / dev-tools, but
 * the user-visible latency must remain bound by the clarify UI, not by
 * gpt-image-1 wire-time.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  runAssetGenStage,
  detectLivingEntity,
} from '@/lib/ai/asset-gen-stage';
import { validatePrompt } from '@/lib/validation/prompt';
import type { ClarifyAnswers } from '@/types';

export const runtime = 'nodejs';

interface PrefetchBody {
  prompt?: unknown;
  /**
   * Default answers (first choice per question) the client computed from
   * the clarify response. We trust the client to derive these — the server
   * does not re-run the question generator (that would defeat the whole
   * point of overlapping with clarify wall-time).
   */
  defaultAnswers?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: PrefetchBody;
  try {
    body = (await req.json()) as PrefetchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.prompt !== 'string') {
    return NextResponse.json(
      { error: 'prompt (string) required' },
      { status: 400 },
    );
  }
  const prompt = body.prompt;
  const promptError = validatePrompt(prompt);
  if (promptError) {
    return NextResponse.json(
      {
        error: promptError.message,
        code: promptError.code,
        ...(promptError.meta ?? {}),
      },
      { status: promptError.status },
    );
  }

  // Coerce defaultAnswers to a plain Record<string,string>. Drop any non-string
  // values defensively — the hash function stringifies but a non-string in the
  // map would silently break parity with the main pipeline's hash.
  const defaultAnswers: ClarifyAnswers = {};
  if (body.defaultAnswers && typeof body.defaultAnswers === 'object') {
    for (const [k, v] of Object.entries(body.defaultAnswers as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string') {
        defaultAnswers[k] = v;
      }
    }
  }

  // Cost guard: only speculate when asset-gen would actually fire downstream.
  const hit = detectLivingEntity(prompt, defaultAnswers);
  if (!hit.matched) {
    return NextResponse.json({
      status: 'skipped',
      reason: 'no-living-entity',
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Image generation is not configured (OPENAI_API_KEY missing).' },
      { status: 503 },
    );
  }

  // Fire the stage. We DO await here — Next.js Node runtime cancels work
  // when the response closes (no event-loop after `return`), so detaching
  // would mean the PNG never lands. The client is expected to not await
  // this response; meanwhile the server happily runs the ~34s job and
  // writes the file under its hash. Subsequent /api/generate calls hit
  // the disk-cache short-circuit.
  try {
    const result = await runAssetGenStage({
      prompt,
      answers: defaultAnswers,
    });
    if (!result) {
      // Living-entity matched on the entry check but the stage returned null
      // (race against patterns changing, or empty prompt edge). Surface as
      // skipped — not a 500.
      return NextResponse.json({ status: 'skipped', reason: 'stage-null' });
    }
    return NextResponse.json({
      status: 'ok',
      cached: result.cached,
      hash: result.hash,
      imageUrl: result.imageUrl,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    // Prefetch is best-effort. Log the failure (so we can detect a flood
    // burning $0.04 each) but surface a soft 200-ish error code so the
    // client never treats this as a user-visible failure.
    const message = err instanceof Error ? err.message : 'prefetch failed';
    console.warn('[TM-157] prefetch asset-gen failed:', message);
    return NextResponse.json({ status: 'error', error: message }, { status: 200 });
  }
}
