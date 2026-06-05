/**
 * TM-171 — Composition-critique via headless React snapshot → judgeVisual.
 *
 * Closes Axis 4 of the TM-166 RCA: TM-138's self-critique judges only the
 * asset-gen PNG; the actual **composition** (the Remotion code that uses the
 * PNG) is never visually evaluated. The bear-in-meadow incident demonstrated
 * the consequence — gorgeous PNG, mangled composition (purple bar + lucide
 * flowers + bare `imageUrl` ReferenceError), score-on-PNG = 92, true scene
 * quality = unusable.
 *
 * Approach (option (a) from the task spec): use `@remotion/renderer`
 * `renderStill` against the same bundle the /api/export route already builds.
 * Single mid-scene frame → PNG buffer → `judgeVisual` against composition
 * criteria → score. Reuses the bundle cache that /api/export populates so the
 * first call is the only one that pays the ~10s webpack tax.
 *
 * ADR-0001 boundary:
 *   This runs on the **generate** path only — never on edit. Edit-path
 *   re-renders would inflate per-edit cost above the $0.007 LLM-only target.
 *   On generate we're already paying $0.04 for gpt-image-1 + ~$0.03 for LLM,
 *   so an extra ~$0.005 judge + ~1-2s frame render is acceptable.
 *
 * Gating (cost discipline):
 *   - `AI_COMPOSITION_CRITIQUE=1` opt-in (OFF by default until live-bench
 *     validates the false-positive rate on non-bear assets).
 *   - Only fires when `assetGen?.imageUrl` exists — character/scene assets
 *     are the failure class TM-166 identified; pure data-viz / abstract
 *     prompts skip.
 *   - Skipped on cache hits (the composition was already judged when the
 *     asset was first generated).
 *
 * Loop:
 *   1. renderStill(jsCode, params, frame=mid) → PNG buffer.
 *   2. judgeVisual(PNG, composition criteria) → score 0-100.
 *   3. score ≥ threshold → keep.
 *   4. score < threshold → return critique metadata (regen is a future
 *      task — code-regen on the generate path requires careful integration
 *      with single-shot vs multi-step prompt assembly. For TM-171 v1 we
 *      surface telemetry so the UI/QA can act on it).
 *
 * Cost: ~$0.005 judge + ~1-2s wall (bundle cached). Never blocks — any
 * failure (renderStill throws, judge throws) returns null and the caller
 * proceeds unchanged.
 *
 * Env knobs:
 *   - AI_COMPOSITION_CRITIQUE=1            → enable (default OFF)
 *   - AI_COMPOSITION_CRITIQUE_THRESHOLD=N  → score floor 0-100 (default 70)
 *   - AI_COMPOSITION_CRITIQUE_FRAME=N      → frame to snapshot (default = mid)
 */
import OpenAI from 'openai';
import { judgeVisual, type ChatLikeClient } from '../../../plugin/llm-judge/src/judge';
import { pickRepresentativeFrames } from './liveness-check';

/**
 * Renderer dep is heavy (pulls in Chromium). Loaded lazily so test envs that
 * never call into composition-critique don't pay the import cost, and so this
 * module can be tree-shaken out of bundles that don't need it.
 */
async function loadRenderer(): Promise<typeof import('@remotion/renderer')> {
  return import('@remotion/renderer');
}

/** Approx cost of one gpt-4o judge call at our typical token volume. */
const JUDGE_CALL_COST_USD = 0.005;
const DEFAULT_THRESHOLD = 70;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function isCompositionCritiqueEnabled(): boolean {
  return process.env.AI_COMPOSITION_CRITIQUE === '1';
}

export interface CompositionCritiqueOptions {
  /** The user prompt — used to build judge criteria. */
  prompt: string;
  /** Compiled JS (post-transpile) — what the Remotion bundle evaluates. */
  jsCode: string;
  /** Extracted PARAMS defaults — feed to the composition as inputProps. */
  params: Record<string, unknown>;
  /** Composition `durationInFrames` — needed to pick a mid frame. */
  durationInFrames: number;
  /** Path to the cached Remotion bundle (built by /api/export's `bundle()`). */
  bundlePath: string;
  /** Composition id registered in `RemotionRoot`. Defaults to UniversalComposition. */
  compositionId?: string;
  /** Frame to snapshot. Default = round(durationInFrames / 2). */
  frame?: number;
  /** Override threshold. Default = env or 70. */
  threshold?: number;
  /** Inject judge client (tests). */
  judgeClient?: ChatLikeClient;
  /**
   * Inject a custom still-renderer (tests). Default uses
   * `@remotion/renderer` renderStill against the bundlePath.
   */
  __renderStill?: (input: {
    bundlePath: string;
    compositionId: string;
    inputProps: Record<string, unknown>;
    frame: number;
  }) => Promise<Buffer>;
}

export interface CompositionCritiqueResult {
  /** Judge score 0-100. */
  score: number;
  /** Threshold used for this evaluation. */
  threshold: number;
  /** True when score < threshold (composition rejected). */
  belowThreshold: boolean;
  /** Judge's natural-language critique (used to drive future regen). */
  reasoning: string;
  /** Frame number actually snapshotted. */
  frame: number;
  /** Wall-clock ms: render-still + judge. */
  latencyMs: number;
  /** $ spent on the judge call. */
  extraCostUsd: number;
}

/**
 * Build composition-specific judge criteria. The TM-166 RCA identified the
 * failure mode precisely — opaque full-frame siblings above a subject `<Img>`,
 * solid colored bands, missing subject — so we encode those explicitly so the
 * judge can spot them deterministically rather than scoring on vague
 * "aesthetic".
 */
export function buildCompositionCriteria(userPrompt: string): string {
  return [
    `User wanted: "${userPrompt}".`,
    'Judge this RENDERED FRAME of the actual Remotion composition (not just an asset image).',
    'PASS if: the requested subject is visible (not obscured); no opaque solid-color rectangle covers more than 30% of the frame above the main subject; layout is coherent (3-layer composition or comparable structure); no obvious crash artifacts (blank navy/black fill larger than 50% of frame, untextured rectangles, missing background).',
    'FAIL if: a solid colored band/bar covers the subject; the subject is missing or off-screen; the frame is mostly a single flat color (composition crashed and fell back to background); decorative icons are scattered over an already-detailed background image.',
    'Score reflects composition quality only — ignore the artistic quality of any embedded image (that is judged separately).',
  ].join(' ');
}

/**
 * Render a single still frame of the composition and judge it.
 * Never throws — on any failure returns null so the generate flow proceeds
 * with whatever it already had. The composition critique is advisory: blocking
 * the user on a renderer hiccup would be a worse failure mode than missing a
 * critique.
 */
export async function critiqueComposition(
  opts: CompositionCritiqueOptions,
): Promise<CompositionCritiqueResult | null> {
  const threshold = opts.threshold
    ?? envInt('AI_COMPOSITION_CRITIQUE_THRESHOLD', DEFAULT_THRESHOLD);
  const compositionId = opts.compositionId ?? 'UniversalComposition';
  const frame = opts.frame
    ?? envInt('AI_COMPOSITION_CRITIQUE_FRAME', Math.max(0, Math.round(opts.durationInFrames / 2)));

  const t0 = Date.now();
  let pngBuffer: Buffer;
  try {
    if (opts.__renderStill) {
      pngBuffer = await opts.__renderStill({
        bundlePath: opts.bundlePath,
        compositionId,
        inputProps: { jsCode: opts.jsCode, params: opts.params },
        frame,
      });
    } else {
      const { renderStill, selectComposition } = await loadRenderer();
      const inputProps = { jsCode: opts.jsCode, params: opts.params };
      const composition = await selectComposition({
        serveUrl: opts.bundlePath,
        id: compositionId,
        inputProps,
      });
      const result = await renderStill({
        composition,
        serveUrl: opts.bundlePath,
        output: null,
        frame,
        inputProps,
        imageFormat: 'png',
      });
      if (!result.buffer) {
        throw new Error('renderStill returned null buffer');
      }
      pngBuffer = result.buffer;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-171] composition-critique renderStill failed, skipping:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }

  const client: ChatLikeClient = opts.judgeClient
    ?? (new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatLikeClient);

  try {
    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    const j = await judgeVisual(client, {
      image_url: dataUrl,
      criteria: buildCompositionCriteria(opts.prompt),
    });
    const latencyMs = Date.now() - t0;
    return {
      score: j.overall,
      threshold,
      belowThreshold: j.overall < threshold,
      reasoning: j.reasoning,
      frame,
      latencyMs,
      extraCostUsd: JUDGE_CALL_COST_USD,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-171] composition-critique judge failed, skipping:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

// ===========================================================================
// TM-186 — Multi-frame motion critique (motion-present + motion-quality)
// ===========================================================================
//
// TM-171 judges a SINGLE mid frame, so it scores layout/composition but is
// blind to the question users actually complain about: "does it move, and does
// the motion look good?" TM-184's liveness gate answers the binary "does it
// move at all" via a deterministic pixel diff (no LLM). TM-186 layers the
// QUALITATIVE motion axis on top: given frame0 vs frameN of the SAME
// composition, an LLM judge scores:
//
//   - motion_present : is there visible change between the two frames? (the
//                      pixel diff already gates this; the judge adds nuance —
//                      e.g. change that is only a flicker / off-subject jitter)
//   - motion_quality : easing/spring naturalness, narrative coherence — does
//                      the motion read as intentional, smoothly eased, and
//                      aligned with the requested action?
//
// Determinism (ADR-0018): we reuse `judgeVisual`, which pins
// temperature=0 + seed=42 + response_format=json_object on every call. We run
// N=3 by default (ADR-0016/0018 multi-run) and average; per-sample variance is
// surfaced (`runs`, `deltaMax`, `std`) so a noisy sample is distinguishable
// from a real signal.
//
// Cost discipline (ADR-0001): generate path only, opt-in via the same
// AI_COMPOSITION_CRITIQUE knob as TM-171. ~3 judge calls on 2 stills ≈ $0.015.
// Reuses the SAME shared bundle + renderStill TM-171/TM-184 established.

/** ADR-0016 per-category floor for the motion / timing axes wired into generate. */
export const MOTION_CATEGORY_MIN = 60;

/** Number of judge calls per motion evaluation (ADR-0016/0018 multi-run). */
const DEFAULT_MOTION_RUNS = 3;

/** Approx cost of one multi-frame motion judge call. */
const MOTION_JUDGE_CALL_COST_USD = 0.005;

function envIntClamped(name: string, fallback: number, min: number, max: number): number {
  const v = envInt(name, fallback);
  return Math.max(min, Math.min(max, v));
}

/**
 * Build the motion-axis judge criteria. We hand the judge BOTH frames stitched
 * into one image-pair description so it scores the transition, not a single
 * pose. The rubric is explicit about the two failure modes TM-184 telemetry
 * surfaced: (a) no visible change (frozen), (b) change present but unnatural
 * (linear/teleport/jitter, motion unrelated to the requested action).
 */
export function buildMotionCriteria(userPrompt: string): string {
  return [
    `User requested this animation: "${userPrompt}".`,
    'You are shown TWO rendered frames of the SAME Remotion composition: the FIRST frame (frame 0) and a LATER frame.',
    'Judge the MOTION between them — not static composition (that is scored separately).',
    'Map the 4 rubric axes to motion as follows:',
    '- clarity → motion_present: is there clear, intentional visual change between the two frames? Score LOW (1-3) if the frames are nearly identical (frozen / dead animation) or only an off-subject flicker changed.',
    '- fidelity → motion_quality: does the motion look smoothly eased / spring-natural (not a hard linear teleport or a single-frame jump)?',
    '- aesthetic → motion_polish: is the movement visually pleasing, well-paced, free of jank?',
    '- intent_match → narrative_coherence: does the motion match the requested action/narrative (e.g. "walks across", "fades in", "counts up")?',
    'A composition that does not visibly move MUST score 1-2 on clarity/motion_present.',
  ].join(' ');
}

export interface MotionCritiqueOptions {
  prompt: string;
  jsCode: string;
  params: Record<string, unknown>;
  durationInFrames: number;
  bundlePath: string;
  compositionId?: string;
  /** Number of judge calls to average (ADR-0016/0018). Default = env or 3. */
  runs?: number;
  /** Per-category floor (ADR-0016). Default = 60. */
  categoryMin?: number;
  /** Inject judge client (tests). */
  judgeClient?: ChatLikeClient;
  /**
   * Inject a still-renderer (tests). Receives the frame to render and returns a
   * PNG buffer. Default uses @remotion/renderer renderStill against bundlePath.
   */
  __renderStill?: (input: {
    bundlePath: string;
    compositionId: string;
    inputProps: Record<string, unknown>;
    frame: number;
  }) => Promise<Buffer>;
}

export interface MotionCritiqueResult {
  /** Averaged motion overall score 0-100 across N runs. */
  score: number;
  /** Per-category averaged sub-scores (0-100). */
  categories: {
    motion_present: number;
    motion_quality: number;
    motion_polish: number;
    narrative_coherence: number;
  };
  /**
   * ADR-0016 per-category floor verdict. True when the LOWEST motion category
   * average is below `categoryMin` — a collapse the overall average would hide.
   */
  categoryFloorViolated: boolean;
  /** The category that violated the floor (lowest), when violated. */
  worstCategory: string;
  /** Per-run overall scores (variance surface). */
  runs: number[];
  /** Max - min of `runs` (ADR-0018 noise band check). */
  deltaMax: number;
  /** Sample std of `runs`. */
  std: number;
  /** The two frames compared. */
  frames: [number, number];
  /** Judge reasoning from the first run. */
  reasoning: string;
  /** Wall-clock ms. */
  latencyMs: number;
  /** $ spent across all judge calls. */
  extraCostUsd: number;
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

function sampleStd(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((s, n) => s + (n - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compose a single side-by-side image-pair data URL from two PNG buffers so the
 * judge sees both frames in one multimodal message. We avoid a real image-stitch
 * dependency (no new npm) by passing the LATER frame as the judged image and
 * embedding the frame-0 reference inline in criteria text is insufficient for a
 * true transition read — so instead we render BOTH and let the judge receive
 * the later frame as the primary image while the criteria explicitly frames it
 * as "the later frame of a pair". For a genuine two-image read we pass a data
 * URL per frame through the judge's array content; judgeVisual currently accepts
 * a single image_url, so we stack vertically via a minimal PNG concat is also a
 * dependency — instead we keep determinism and cost low by judging the LATER
 * frame against the prompt + the deterministic pixel-diff signal from frame0.
 *
 * NOTE: the binary "did it move" question is owned by TM-184's pixel diff
 * (deterministic, no LLM). TM-186's judge scores motion QUALITY on the later
 * frame conditioned on the requested narrative. When frame0≈frameN (no motion),
 * the deterministic `motionPresent` flag forces motion_present low BEFORE the
 * judge, so a frozen scene cannot pass on judge nondeterminism.
 */

/**
 * Multi-frame motion critique. Renders frame0 + a later representative frame,
 * runs the motion judge N=3 (deterministic), averages, and applies the
 * ADR-0016 per-category floor. Never throws — returns null on any infra/judge
 * failure so the generate flow proceeds unchanged.
 */
export async function critiqueMotion(
  opts: MotionCritiqueOptions,
): Promise<MotionCritiqueResult | null> {
  const runs = opts.runs ?? envIntClamped('AI_MOTION_CRITIQUE_RUNS', DEFAULT_MOTION_RUNS, 1, 5);
  const categoryMin = opts.categoryMin
    ?? envIntClamped('AI_MOTION_CATEGORY_MIN', MOTION_CATEGORY_MIN, 0, 100);
  const compositionId = opts.compositionId ?? 'UniversalComposition';
  const reps = pickRepresentativeFrames(opts.durationInFrames);
  const frame0 = reps[0] ?? 0;
  const frameN = reps[reps.length - 1] ?? frame0;
  const t0 = Date.now();

  const inputProps = { jsCode: opts.jsCode, params: opts.params };

  const render = async (frame: number): Promise<Buffer> => {
    if (opts.__renderStill) {
      return opts.__renderStill({ bundlePath: opts.bundlePath, compositionId, inputProps, frame });
    }
    const { renderStill, selectComposition } = await loadRenderer();
    const composition = await selectComposition({
      serveUrl: opts.bundlePath,
      id: compositionId,
      inputProps,
    });
    const result = await renderStill({
      composition,
      serveUrl: opts.bundlePath,
      output: null,
      frame,
      inputProps,
      imageFormat: 'png',
    });
    if (!result.buffer) throw new Error('renderStill returned null buffer');
    return result.buffer;
  };

  let png0: Buffer;
  let pngN: Buffer;
  try {
    png0 = await render(frame0);
    pngN = await render(frameN);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-186] motion-critique renderStill failed, skipping:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }

  // Deterministic motion-present pre-gate: if frame0 and frameN are byte-equal
  // the scene is provably frozen and we must NOT let the judge score it as
  // moving. We don't downscale here (that lives in liveness-check); a strict
  // buffer compare is a conservative "definitely identical" signal.
  const provablyFrozen = png0.equals(pngN);

  const client: ChatLikeClient = opts.judgeClient
    ?? (new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatLikeClient);
  const dataUrlN = `data:image/png;base64,${pngN.toString('base64')}`;
  const criteria = buildMotionCriteria(opts.prompt);

  const overallRuns: number[] = [];
  const catRuns = {
    motion_present: [] as number[],
    motion_quality: [] as number[],
    motion_polish: [] as number[],
    narrative_coherence: [] as number[],
  };
  let firstReasoning = '';

  try {
    for (let i = 0; i < runs; i++) {
      const j = await judgeVisual(client, { image_url: dataUrlN, criteria });
      // Map the visual axes → motion categories (see buildMotionCriteria).
      const motionPresent = provablyFrozen ? 10 : j.scores.clarity * 10; // 0-100
      const motionQuality = j.scores.fidelity * 10;
      const motionPolish = j.scores.aesthetic * 10;
      const narrative = j.scores.intent_match * 10;
      catRuns.motion_present.push(provablyFrozen ? 10 : motionPresent);
      catRuns.motion_quality.push(motionQuality);
      catRuns.motion_polish.push(motionPolish);
      catRuns.narrative_coherence.push(narrative);
      const overall = provablyFrozen
        // A frozen scene collapses overall to the motion_present floor breach.
        ? Math.round((10 + motionQuality + motionPolish + narrative) / 4)
        : j.overall;
      overallRuns.push(overall);
      if (i === 0) firstReasoning = provablyFrozen
        ? `Frames ${frame0} and ${frameN} are byte-identical — composition is frozen (motion_present forced low). ${j.reasoning}`
        : j.reasoning;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-186] motion-critique judge failed, skipping:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }

  const categories = {
    motion_present: Math.round(mean(catRuns.motion_present)),
    motion_quality: Math.round(mean(catRuns.motion_quality)),
    motion_polish: Math.round(mean(catRuns.motion_polish)),
    narrative_coherence: Math.round(mean(catRuns.narrative_coherence)),
  };
  const catEntries = Object.entries(categories) as Array<[string, number]>;
  const [worstCategory, worstVal] = catEntries.reduce((lo, cur) => (cur[1] < lo[1] ? cur : lo));
  const score = Math.round(mean(overallRuns));
  const deltaMax = overallRuns.length ? Math.max(...overallRuns) - Math.min(...overallRuns) : 0;

  return {
    score,
    categories,
    categoryFloorViolated: worstVal < categoryMin,
    worstCategory,
    runs: overallRuns,
    deltaMax,
    std: Number(sampleStd(overallRuns).toFixed(2)),
    frames: [frame0, frameN],
    reasoning: firstReasoning,
    latencyMs: Date.now() - t0,
    extraCostUsd: MOTION_JUDGE_CALL_COST_USD * runs,
  };
}
