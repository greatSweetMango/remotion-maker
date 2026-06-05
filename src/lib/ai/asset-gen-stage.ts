/**
 * TM-90 — multi-step pipeline asset-gen stage (ADR-0022 1차 통합).
 *
 * Wraps `generateAssetImage` (TM-84) so the multi-step pipeline can:
 *
 *   1. Detect "living entity" prompts (character / animal / person) for which
 *      a generated PNG meaningfully improves visual fidelity over pure
 *      Remotion primitives (data-viz / abstract motion-graphics gain
 *      nothing from a still PNG).
 *   2. Generate ONE PNG via OpenAI gpt-image-1, persist locally under
 *      `public/uploads/asset-gen/<sha256>.png`, and surface a public URL
 *      that the scene-code stage can splice into `<Img src={...} />`.
 *   3. Skip when no living-entity signal fires OR when an identical hash
 *      already exists on disk (idempotent — same prompt + answers ⇒ same
 *      file). An in-memory cache short-circuits hash-collision re-checks
 *      within a single Node process.
 *
 * Cost guard: ONE call per `runAssetGenStage` invocation, max. The caller
 * (pipeline.ts) decides when to invoke and respects the same-process
 * idempotency cache so repeated edits don't burn additional dollars.
 *
 * Storage (TM-89, ADR-0022 follow-up): a pluggable persistent cache via
 * `./asset-cache`. Default backend = local FS (no creds); when R2 env vars
 * are present the cache is served from R2 so it survives serverless
 * redeploys. The only behaviour change vs TM-90 is that a cache hit skips
 * the image-gen LLM call (cost recorded as 0 — see `recordAssetGenSpend`).
 */
import { createHash } from 'node:crypto';
import { generateAssetImage } from './asset-gen';
import type { ClarifyAnswers } from '@/types';
import { recordMark, isLatencyProfileEnabled } from './latency-profile';
import { getAssetCache, ASSET_GEN_DIR_REL, ASSET_GEN_PUBLIC_PREFIX, type AssetCache } from './asset-cache';
import { recordUsage } from './spend';

/* ------------------------------------------------------------------ */
/* Living-entity detection                                            */
/* ------------------------------------------------------------------ */

/**
 * Patterns that indicate the prompt names a CHARACTER / ANIMAL / PERSON
 * worth materialising as a PNG. Mirrors the SCOPE NOTE in the
 * GENERATION_WITH_CLARIFY_SYSTEM_PROMPT living-entity exception (TM-95
 * narrow). Kept intentionally short — false-positives waste $0.04, but
 * false-negatives merely keep the pre-TM-90 behaviour, which is fine.
 */
const LIVING_ENTITY_PATTERNS: RegExp[] = [
  // English nouns
  /\b(character|person|people|girl|boy|man|woman|child|kid|guy|hero|astronaut|wizard|knight|robot|monster|creature|dragon|cat|dog|puppy|kitten|bear|fox|rabbit|bunny|tiger|lion|panda|owl|bird|fish|whale|dolphin|unicorn|alien|zombie|ninja|samurai|princess|prince)\b/i,
  // Korean nouns (subjects only — not 곰돌이가 → 곰돌이)
  /(곰돌이|강아지|고양이|사람|아이|소년|소녀|남자|여자|용|로봇|괴물|영웅|우주인|마법사|기사|토끼|호랑이|사자|판다|올빼미|새|물고기|돌고래|유니콘|외계인|좀비|닌자|사무라이|공주|왕자|캐릭터)/,
];

export interface LivingEntityHit {
  matched: boolean;
  /** First matching substring — exposed for telemetry / debug logging. */
  matchedToken?: string;
}

/**
 * Pure detector. Combines the user's prompt and any clarify answers (which
 * frequently carry the actual subject choice — "캐릭터: 곰돌이").
 */
export function detectLivingEntity(
  prompt: string,
  answers?: ClarifyAnswers,
): LivingEntityHit {
  const blobParts = [prompt ?? ''];
  if (answers) {
    for (const [k, v] of Object.entries(answers)) {
      blobParts.push(String(k));
      blobParts.push(String(v));
    }
  }
  const blob = blobParts.join(' ');
  for (const re of LIVING_ENTITY_PATTERNS) {
    const m = blob.match(re);
    if (m) return { matched: true, matchedToken: m[0] };
  }
  return { matched: false };
}

/* ------------------------------------------------------------------ */
/* Hash + storage                                                     */
/* ------------------------------------------------------------------ */

// Re-exported from the FS cache backend so existing importers keep working.
export { ASSET_GEN_DIR_REL, ASSET_GEN_PUBLIC_PREFIX };

/** sha256 of canonical (prompt + sorted answers + style) — stable across runs. */
export function hashAssetGenInputs(
  prompt: string,
  answers?: ClarifyAnswers,
  style: string = 'default',
): string {
  const sortedAnswers = answers
    ? Object.keys(answers)
        .sort()
        .map((k) => `${k}=${answers[k]}`)
        .join('|')
    : '';
  const canonical = `${prompt.trim()}\n${sortedAnswers}\n${style}`;
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Module-local short-circuit so back-to-back generate calls in the same
 * Node process don't even hit the filesystem. Bounded by hash-set size —
 * acceptable for a single dev/server lifetime.
 */
const inMemoryHashCache = new Set<string>();

/** Test-only — reset the in-memory cache between Jest cases. */
export function __resetAssetGenCache(): void {
  inMemoryHashCache.clear();
}

/**
 * TM-89 — record the cost of an asset-gen image call into the spend ledger
 * (`.agent-state/spend.json`). On a cache HIT this is a no-op (cost 0, no
 * tokens) so the ledger never double-counts a re-used asset — satisfying the
 * ADR-0022 "캐시 히트 시 비용 0 기록" requirement. On a MISS we attribute the
 * flat gpt-image-1 price as an `openai` line so the nightly budget cap and
 * `openai_total_usd` see image-gen spend (which token-based recordUsage would
 * otherwise miss — images carry no prompt/completion token counts).
 *
 * Best-effort: recordUsage already swallows IO errors and returns null.
 */
export function recordAssetGenSpend(costUsd: number): void {
  if (!costUsd || costUsd <= 0) return; // cache hit → zero-cost, nothing to record
  // gpt-image-1 has no token usage; encode the flat per-image price as a
  // single "input token" against a synthetic $1/1M-token rate so the existing
  // openai cost math (in/1M) yields exactly costUsd.
  recordUsage({
    provider: 'openai',
    model: 'gpt-image-1',
    usage: { prompt_tokens: Math.round(costUsd * 1_000_000), completion_tokens: 0 },
  });
}

/* ------------------------------------------------------------------ */
/* Stage entry                                                        */
/* ------------------------------------------------------------------ */

export interface AssetGenStageInput {
  prompt: string;
  answers?: ClarifyAnswers;
  /** Style hint forwarded to the image prompt. Defaults to a neutral cartoon. */
  style?: string;
  /** Test seam — inject a stub generator so unit tests stay offline. */
  imageGenerator?: typeof generateAssetImage;
  /** TM-89 test/DI seam — inject a cache backend (defaults to env selection). */
  cache?: AssetCache;
  /** TM-89 test seam — override the spend recorder (defaults to recordAssetGenSpend). */
  recordSpend?: (costUsd: number) => void;
  /** TM-156 — request id propagation for structured stage marks. */
  __latencyReqId?: string;
}

export interface AssetGenStageResult {
  imageUrl: string;
  costUsd: number;
  latencyMs: number;
  /** True when the asset was served from cache (no image-gen call made). */
  cached: boolean;
  hash: string;
  matchedToken: string;
  /** TM-89 — which cache backend served/stored this asset ("fs" | "r2"). */
  cacheProvider?: string;
}

/**
 * Run the asset-gen stage. Returns `null` when no living-entity signal
 * fires (the pipeline then skips PNG injection entirely). Throws only for
 * configuration errors (missing OPENAI_API_KEY when a call is required) —
 * runtime failures bubble up so the orchestrator can decide whether to
 * fall back.
 */
export async function runAssetGenStage(
  input: AssetGenStageInput,
): Promise<AssetGenStageResult | null> {
  const hit = detectLivingEntity(input.prompt, input.answers);
  if (!hit.matched) return null;

  // TM-153 — prompt diet. The previous default style suffix was 88 chars
  // of generic adjectives ("friendly cartoon illustration, transparent
  // background, soft colors, centered composition") that competed with the
  // richer per-prompt clarify answers and added ~2s latency without quality
  // gain. Live A/B (3 character fixtures × {long, hybrid}, gpt-image-1
  // low) showed hybrid -2.2s p50 latency AND +4pt judge score (long mean 89
  // → hybrid 93). See wiki/05-reports/2026-05-18-TM-153-prompt-diet-bench.md.
  // The `style` argument is kept (so callers can opt back in) but defaults
  // to empty — `buildImagePrompt` skips the suffix when style is blank.
  const style = input.style ?? '';
  const hash = hashAssetGenInputs(input.prompt, input.answers, style);

  const cache = input.cache ?? getAssetCache();
  const recordSpend = input.recordSpend ?? recordAssetGenSpend;
  const matchedToken = hit.matchedToken ?? '';

  // 1. In-memory short-circuit (same process, repeat call) — avoids even a
  //    cache round-trip. The URL is reconstructed from the active backend on
  //    the persistent-hit path below, so we only short-circuit here when we
  //    already know the backend served it this process. To stay backend-
  //    agnostic we re-check the persistent cache when not in-memory.
  if (inMemoryHashCache.has(hash)) {
    const memHit = await cache.get(hash);
    if (memHit) {
      recordSpend(0);
      return {
        imageUrl: memHit.url,
        costUsd: 0,
        latencyMs: 0,
        cached: true,
        hash,
        matchedToken,
        cacheProvider: memHit.provider,
      };
    }
    // Entry vanished from the backend (e.g. redeploy wiped FS) — fall through.
  }

  // 2. Persistent cache lookup (FS or R2). Hit ⇒ skip image-gen (ADR-0022).
  const persistedHit = await cache.get(hash);
  if (persistedHit) {
    inMemoryHashCache.add(hash);
    recordSpend(0); // ADR-0022: record cost 0 on a cache hit.
    return {
      imageUrl: persistedHit.url,
      costUsd: 0,
      latencyMs: 0,
      cached: true,
      hash,
      matchedToken,
      cacheProvider: persistedHit.provider,
    };
  }

  // 3. Miss — generate + persist into the cache.
  const reqId = input.__latencyReqId ?? 'no-req';
  const profileOn = isLatencyProfileEnabled();
  const promptBuildStart = Date.now();
  const imagePrompt = buildImagePrompt(input.prompt, input.answers, style);
  if (profileOn) recordMark({ req: reqId, phase: 'asset-gen-stage.prompt-build', ms: Date.now() - promptBuildStart, meta: { promptChars: imagePrompt.length } });

  const gen = (input.imageGenerator ?? generateAssetImage);
  const genStart = Date.now();
  const result = await gen({ prompt: imagePrompt, __latencyReqId: reqId });
  if (profileOn) recordMark({ req: reqId, phase: 'asset-gen-stage.generate-total', ms: Date.now() - genStart, meta: { reportedLatencyMs: result.latencyMs, costUsd: result.costUsd } });

  const persistStart = Date.now();
  const url = await cache.put({ cacheKey: hash, bytes: result.pngBytes });
  if (profileOn) recordMark({ req: reqId, phase: 'asset-gen-stage.cache-put', ms: Date.now() - persistStart, meta: { bytes: result.pngBytes.length, provider: cache.name } });
  inMemoryHashCache.add(hash);
  recordSpend(result.costUsd); // ADR-0022: attribute the generation cost.

  return {
    imageUrl: url,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    cached: false,
    cacheProvider: cache.name,
    hash,
    matchedToken: hit.matchedToken ?? '',
  };
}

/**
 * Compose the PNG-generation prompt from the user's original prompt + any
 * clarify answers + the style hint. Kept simple — gpt-image-1 prefers
 * descriptive natural language over instruction blocks.
 */
export function buildImagePrompt(
  prompt: string,
  answers: ClarifyAnswers | undefined,
  style: string,
): string {
  const answerText = answers && Object.keys(answers).length > 0
    ? ' ' + Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  // TM-153 hybrid diet — only append the style suffix when a caller
  // explicitly provides one. Default callers (pipeline.ts → runAssetGenStage)
  // now pass style='' so the prompt is just `${prompt}${answerText}`.
  const styleSuffix = style && style.trim().length > 0 ? `. Style: ${style}.` : '';
  return `${prompt}${answerText}${styleSuffix}`;
}
