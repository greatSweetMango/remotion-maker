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
