/**
 * TM-142 — sprite-sheet pipeline (4-frame walk-cycle).
 *
 * # Why this exists
 *
 * TM-90 / TM-136 generate ONE PNG of the prompt's living-entity subject,
 * which is great for "곰돌이 사진" but visually static for animations like
 * "곰돌이가 초원을 걸어가는 10초 영상" — the LLM ends up sliding a still
 * bear across the screen with `translateX`, which reads as a teleporting
 * billboard rather than a walking creature.
 *
 * This stage produces a 4-frame walk-cycle sprite sheet (frames stored
 * separately on disk, NOT stitched into a single PNG — stitching would
 * require `sharp` or `canvas` and the user explicitly approved a
 * dependency-free implementation). The companion `<SpriteAnimator>`
 * Remotion component cycles through the frames at a configurable fps so
 * the bear actually appears to walk.
 *
 * # Cost
 *
 * 4× gpt-image-1 calls per first-generation. At the spike-tier `low`
 * quality 1024×1024 price ($0.04 / image) that's ~$0.16 per cycle.
 * Cached hits (same prompt + answers tuple) are free. The user-visible
 * cost cap is enforced by the caller (orchestrator / verify script);
 * THIS stage does not retry or self-judge — keep it boringly cheap.
 *
 * # Design choices
 *
 * - Reuses `detectLivingEntity` from asset-gen-stage so the same prompts
 *   that qualify for TM-90 PNGs qualify for TM-142 sprite sheets. The
 *   selector between the two paths is the `AI_SPRITE_SHEET=1` env opt-in
 *   on the caller side.
 * - Storage layout `public/uploads/sprites/<hash>/{1,2,3,4}.png` mirrors
 *   the TM-109 / TM-90 single-PNG pattern: hash-keyed directory of
 *   asset files, public URL prefix `/uploads/sprites/<hash>/N.png`.
 *   A directory-per-hash makes per-cycle cleanup trivial (`rm -rf` one
 *   dir) and keeps the asset-gen flat directory uncluttered.
 * - Frame prompts use a fixed walk-cycle template:
 *     1: leg-down  (anchor pose)
 *     2: leg-mid (lift)
 *     3: leg-up
 *     4: leg-mid (drop, mirror of 2)
 *   The "side view, transparent background, frame N of 4" prefix gives
 *   gpt-image-1 enough structural context to keep the same character
 *   while varying only the leg pose — empirically (TM-142 spike) this
 *   is enough for a recognisable cycle without a true character-sheet
 *   model.
 * - No retries / no vision judge in this stage. TM-138 self-critique is
 *   single-PNG-shaped and does not generalise to sprite sheets without
 *   per-frame judging (4× extra cost). Future task can add it; for the
 *   spike we accept whatever gpt-image-1 emits.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateAssetImage } from './asset-gen';
import { detectLivingEntity, type LivingEntityHit } from './asset-gen-stage';
import type { ClarifyAnswers } from '@/types';

/* ------------------------------------------------------------------ */
/* Storage paths                                                      */
/* ------------------------------------------------------------------ */

export const SPRITE_SHEET_DIR_REL = path.join('public', 'uploads', 'sprites');
export const SPRITE_SHEET_PUBLIC_PREFIX = '/uploads/sprites';
export const SPRITE_SHEET_FRAME_COUNT = 4;

/** Re-export so consumers don't need a second import. */
export { detectLivingEntity };
export type { LivingEntityHit };

/* ------------------------------------------------------------------ */
/* Hash + canonicalisation                                            */
/* ------------------------------------------------------------------ */

/**
 * sha256 over (prompt + sorted answers + style + frame-count). Stable
 * across processes — same inputs ⇒ same on-disk directory ⇒ instant
 * cache hit on second generate.
 */
export function hashSpriteSheetInputs(
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
  const canonical = `${prompt.trim()}\n${sortedAnswers}\n${style}\nframes=${SPRITE_SHEET_FRAME_COUNT}`;
  return createHash('sha256').update(canonical).digest('hex');
}

const inMemoryHashCache = new Set<string>();

/** Test-only — reset the in-memory cache between Jest cases. */
export function __resetSpriteSheetCache(): void {
  inMemoryHashCache.clear();
}

function publicUrlFor(hash: string, frameOneBased: number): string {
  return `${SPRITE_SHEET_PUBLIC_PREFIX}/${hash}/${frameOneBased}.png`;
}

function diskPathFor(hash: string, frameOneBased: number): string {
  return path.join(
    process.cwd(),
    SPRITE_SHEET_DIR_REL,
    hash,
    `${frameOneBased}.png`,
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Walk-cycle prompt template                                         */
/* ------------------------------------------------------------------ */

/**
 * Per-frame leg pose descriptors. Index 0 → frame 1, etc. Kept short so
 * the model treats them as STYLE hints rather than separate scenes —
 * empirically a longer description encourages gpt-image-1 to render the
 * descriptor text instead of the pose.
 */
export const WALK_CYCLE_FRAME_POSES: readonly string[] = [
  'standing pose, both legs together (anchor pose)',
  'left leg lifted forward, mid-stride',
  'left leg fully extended forward, right leg back (peak stride)',
  'right leg lifted forward, mid-stride (mirror of frame 2)',
];

/**
 * Build the per-frame image prompt. The base description (subject +
 * style + transparent background + side view) is identical across all 4
 * frames so gpt-image-1 keeps the SAME character; only the pose varies.
 */
export function buildSpriteFramePrompt(
  prompt: string,
  answers: ClarifyAnswers | undefined,
  style: string,
  frameOneBased: number,
): string {
  const idx = frameOneBased - 1;
  if (idx < 0 || idx >= WALK_CYCLE_FRAME_POSES.length) {
    throw new Error(
      `sprite-sheet: frame index out of range (${frameOneBased}, expected 1..${SPRITE_SHEET_FRAME_COUNT})`,
    );
  }
  const answerText = answers && Object.keys(answers).length > 0
    ? ' ' + Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  const pose = WALK_CYCLE_FRAME_POSES[idx];
  return [
    `${prompt}${answerText}.`,
    `Walk-cycle frame ${frameOneBased} of ${SPRITE_SHEET_FRAME_COUNT}: ${pose}.`,
    `Side view, full body visible, transparent background, centered composition.`,
    `Style: ${style}.`,
    `IMPORTANT: keep the SAME character across all frames — same colors, same proportions, same outfit. Only the leg/arm pose changes.`,
  ].join(' ');
}

/* ------------------------------------------------------------------ */
/* Stage entry                                                        */
/* ------------------------------------------------------------------ */

export interface SpriteSheetStageInput {
  prompt: string;
  answers?: ClarifyAnswers;
  /** Style hint forwarded to each frame prompt. */
  style?: string;
  /** Test seam — inject a stub generator so unit tests stay offline. */
  imageGenerator?: typeof generateAssetImage;
}

export interface SpriteSheetStageResult {
  /** Public URLs in frame order (1..4). Hand these to <SpriteAnimator>. */
  frames: string[];
  /** Sum of per-frame costs (USD). 0 when fully cached. */
  costUsd: number;
  /** Total wall-clock for the FRESH frame generations (cached frames don't count). */
  latencyMs: number;
  /** True iff every frame already existed on disk (no API calls made). */
  cached: boolean;
  /** Per-frame breakdown — useful for telemetry / partial-failure forensics. */
  perFrame: { url: string; cached: boolean; costUsd: number; latencyMs: number }[];
  hash: string;
  matchedToken: string;
}

/**
 * Run the sprite-sheet stage. Returns `null` when no living-entity
 * signal fires (the pipeline then skips sprite injection entirely).
 *
 * Idempotency: per-frame disk cache. If frame K already exists we skip
 * its API call regardless of whether siblings are present, so a partial
 * failure on a previous run only re-bills the missing frames.
 *
 * Throws only for configuration errors (missing OPENAI_API_KEY when an
 * actual call would be required) — runtime API failures bubble up so
 * the orchestrator can decide whether to fall back to single-PNG mode.
 */
export async function runSpriteSheetStage(
  input: SpriteSheetStageInput,
): Promise<SpriteSheetStageResult | null> {
  const hit = detectLivingEntity(input.prompt, input.answers);
  if (!hit.matched) return null;

  const style = input.style ?? 'friendly cartoon illustration, soft colors, clean lines';
  const hash = hashSpriteSheetInputs(input.prompt, input.answers, style);

  // In-memory short-circuit — same process repeated call.
  if (inMemoryHashCache.has(hash)) {
    const frames = Array.from({ length: SPRITE_SHEET_FRAME_COUNT }, (_, i) =>
      publicUrlFor(hash, i + 1),
    );
    return {
      frames,
      costUsd: 0,
      latencyMs: 0,
      cached: true,
      perFrame: frames.map((url) => ({ url, cached: true, costUsd: 0, latencyMs: 0 })),
      hash,
      matchedToken: hit.matchedToken ?? '',
    };
  }

  const gen = input.imageGenerator ?? generateAssetImage;
  const dir = path.join(process.cwd(), SPRITE_SHEET_DIR_REL, hash);
  await fs.mkdir(dir, { recursive: true });

  const perFrame: SpriteSheetStageResult['perFrame'] = [];
  let totalCost = 0;
  let totalLatency = 0;
  let allCached = true;

  for (let i = 1; i <= SPRITE_SHEET_FRAME_COUNT; i++) {
    const diskPath = diskPathFor(hash, i);
    const url = publicUrlFor(hash, i);

    if (await fileExists(diskPath)) {
      perFrame.push({ url, cached: true, costUsd: 0, latencyMs: 0 });
      continue;
    }

    allCached = false;
    const framePrompt = buildSpriteFramePrompt(input.prompt, input.answers, style, i);
    const result = await gen({ prompt: framePrompt });
    await fs.writeFile(diskPath, result.pngBytes);
    perFrame.push({
      url,
      cached: false,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    });
    totalCost += result.costUsd;
    totalLatency += result.latencyMs;
  }

  inMemoryHashCache.add(hash);

  return {
    frames: perFrame.map((f) => f.url),
    costUsd: totalCost,
    latencyMs: totalLatency,
    cached: allCached,
    perFrame,
    hash,
    matchedToken: hit.matchedToken ?? '',
  };
}
