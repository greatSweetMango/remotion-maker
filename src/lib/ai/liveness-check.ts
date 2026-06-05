/**
 * TM-184 — Motion liveness gate (positive across-frame motion check).
 *
 * The user-reported failure "애니메이션이 안 움직인다" (the animation doesn't
 * move) slips through every existing validator because all of them are
 * NEGATIVE gates — deny-lists and structural rejects. None of them assert the
 * one property the user actually cares about: **does the output actually change
 * from frame to frame?** A composition can:
 *   - never call `useCurrentFrame()` (renders a static poster),
 *   - drive only `translateX` off the frame while everything else is a flat
 *     static background (technically moving but visually dead),
 * and still pass classification, security validation, empty-composition
 * detection (TM-182), CSS-freeze detection (TM-185) and composition critique.
 *
 * This module adds the missing POSITIVE liveness gate. It is **complementary**,
 * not a duplicate, of the sibling checks:
 *
 *   - TM-182 `detectEmptyComposition` (generate.ts) — single-frame "paints
 *     nothing" fingerprint. Orthogonal: a static-but-painted scene passes
 *     TM-182 yet fails liveness; an empty scene fails TM-182 before liveness
 *     ever runs (we run AFTER it in the pipeline so we never double-report).
 *   - TM-185 `validateFrameDrivenMotion` (sandbox.ts) — flags CSS
 *     `@keyframes`/`animation`/`transition` that freeze at t=0. Orthogonal:
 *     TM-185 catches motion expressed the WRONG way; TM-184 catches motion
 *     that is ABSENT entirely (no frame-driven references at all) and motion
 *     that LOOKS present in source but produces identical rendered frames.
 *
 * Two-stage design (cost discipline — acceptance: <2s added latency):
 *
 *   Stage 1 — AST pre-filter (`detectStaticMotionSource`), free, no render:
 *     promotes the prompts.ts:592 self-check ("you MUST drive motion from
 *     useCurrentFrame") from advice to enforcement. If the component body
 *     references useCurrentFrame / interpolate / spring ZERO times, the output
 *     is provably static — reject immediately without paying the render tax.
 *     Reuses TM-185's `validateFrameDrivenMotion` for the CSS-freeze axis so
 *     the two gates never disagree.
 *
 *   Stage 2 — rendered cross-frame diff (`checkRenderedLiveness`):
 *     renders 3 representative frames (0, mid, last) via the SAME
 *     `@remotion/renderer` renderStill + shared-bundle path TM-171 established,
 *     downscales to a tiny grid, and compares them by per-channel variance /
 *     mean-abs-diff. If every adjacent pair is effectively identical
 *     (diff < ε) the composition is static even though source-level heuristics
 *     passed (e.g. frame-driven value computed but never bound to a style, or
 *     bound to an off-screen element).
 *
 * ADR-0001: generate path ONLY. Never on edit (per-edit renders blow the
 *   LLM-only cost target). The orchestrator caller enforces this.
 * ADR-0002: PARAMS untouched — we read params as inputProps, never rewrite.
 * ADR-0016/0017/0018: deterministic — fixed frames, fixed downscale grid,
 *   fixed ε. No randomness, no model call in the render path (the diff is
 *   pure arithmetic, so no judge nondeterminism).
 *
 * NEVER throws on a renderer hiccup: `checkRenderedLiveness` returns a
 * `skipped` verdict on any infra failure so a Chrome/bundle problem degrades
 * to "no signal" rather than blocking the user (acceptance: 절대 silent blank
 * 금지 — but also never block on our own infra failure).
 */
import { validateFrameDrivenMotion } from '../remotion/sandbox';

// ---------------------------------------------------------------------------
// Env gating
// ---------------------------------------------------------------------------

/**
 * Default ON for character/scene generations (the failure class users hit),
 * but the whole gate is killable via env for incident response / FP spikes.
 *
 *   AI_LIVENESS_GATE=0        → fully disabled (both stages).
 *   AI_LIVENESS_GATE_RENDER=0 → AST stage only; skip the render diff (keeps
 *                                the free positive check, drops the 1-2s cost).
 *   AI_LIVENESS_GATE_RENDER=1 → force the render diff ON even under the test
 *                                runner (explicit opt-in for render-stage tests).
 */
export function isLivenessGateEnabled(): boolean {
  return process.env.AI_LIVENESS_GATE !== '0';
}

export function isLivenessRenderEnabled(): boolean {
  if (!isLivenessGateEnabled()) return false;
  // Explicit override always wins.
  if (process.env.AI_LIVENESS_GATE_RENDER === '0') return false;
  if (process.env.AI_LIVENESS_GATE_RENDER === '1') return true;
  // Stage 2 spins up a Remotion bundle + renderStill (heavy). Under the jest
  // runner this turns unit suites that exercise the full generate path into
  // slow/flaky real renders, so default the render diff OFF in tests. The free
  // AST stage still runs; production (NODE_ENV!=='test') keeps the render diff.
  const inTestRunner =
    process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  return !inTestRunner;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Stage 1 — AST / source pre-filter (free)
// ---------------------------------------------------------------------------

// Frame-driven motion primitives. A composition that references NONE of these
// cannot change across frames (Remotion renders each frame in isolation, so
// the only per-frame input is useCurrentFrame()/useVideoConfig().frame and the
// spring()/interpolate() that consume it). `\b` anchored so we don't match
// substrings inside unrelated identifiers.
const FRAME_DRIVEN_REF_RE =
  /\b(useCurrentFrame|interpolate|interpolateColors|spring)\b/;

/**
 * Strip line + block comments and string/template literals so a stray mention
 * of "useCurrentFrame" inside a comment or a label string does NOT count as a
 * real reference. Conservative: when in doubt we keep characters, which only
 * risks a false NEGATIVE (letting a static scene through to the render stage),
 * never a false positive reject.
 */
function stripCommentsAndStrings(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];
    // line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    // block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // string / template literal
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) { i++; break; }
        i++;
      }
      out += ' '; // collapse the literal to whitespace
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export interface StaticMotionReason {
  /** Short machine code for telemetry. */
  code: 'no-frame-driven-ref' | 'css-freeze';
  /** Human-readable reason surfaced to the retry prompt / warning. */
  message: string;
}

/**
 * Stage-1 free check. Returns reasons the SOURCE is provably static.
 * Empty list = source-level liveness plausible (proceed to render diff).
 *
 * - `no-frame-driven-ref`: zero useCurrentFrame/interpolate/spring references
 *   in the (comment/string-stripped) body. This is the prompts.ts:592 rule
 *   turned into hard enforcement.
 * - `css-freeze`: delegates to TM-185 so the two gates stay consistent. A
 *   scene whose ONLY motion is a CSS animation/transition is frozen at t=0 and
 *   therefore static — we surface it here too (deduped by the caller).
 */
export function detectStaticMotionSource(code: string): StaticMotionReason[] {
  const reasons: StaticMotionReason[] = [];
  const body = stripCommentsAndStrings(code ?? '');

  if (!FRAME_DRIVEN_REF_RE.test(body)) {
    reasons.push({
      code: 'no-frame-driven-ref',
      message:
        'Static composition (TM-184): the component never references useCurrentFrame()/interpolate()/spring(), so every frame renders identically. All visible motion MUST be driven from useCurrentFrame() (Remotion renders each frame in isolation — a value that does not depend on the current frame cannot animate).',
    });
  }

  // TM-185 CSS-freeze axis: a scene whose only "motion" is CSS keyframes /
  // transition is also static under frame-isolated render. Reuse the single
  // source of truth (sandbox.ts) rather than re-implementing the regexes.
  // Defensive: some unit suites mock '@/lib/remotion/sandbox' with a partial
  // shape that omits this export — treat absence as "no css-freeze signal"
  // rather than throwing (the primary no-frame-driven-ref check stands alone).
  if (typeof validateFrameDrivenMotion === 'function') {
    const cssFreeze = validateFrameDrivenMotion(code ?? '');
    if (cssFreeze.length > 0) {
      reasons.push({
        code: 'css-freeze',
        message: cssFreeze[0],
      });
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Stage 2 — rendered cross-frame diff
// ---------------------------------------------------------------------------

/**
 * Renderer dep is heavy (Chromium). Lazy import so test/edit paths that never
 * call into the render stage don't pay it (mirrors composition-critique.ts).
 */
async function loadRenderer(): Promise<typeof import('@remotion/renderer')> {
  return import('@remotion/renderer');
}

/**
 * Default diff floor. The mean-absolute per-pixel-channel difference between
 * two downscaled frames (0-255 scale). Below this, adjacent frames are
 * "effectively identical". 2.0 ≈ <1% average channel change — empirically well
 * below any genuine animation and above PNG-encode/AA jitter. Tunable via
 * AI_LIVENESS_DIFF_EPSILON.
 */
const DEFAULT_DIFF_EPSILON = 2.0;

/** Downscale target — small enough to be cheap, big enough to catch localized motion. */
const DOWNSCALE = 32;

export interface LivenessRenderOptions {
  jsCode: string;
  params: Record<string, unknown>;
  durationInFrames: number;
  bundlePath: string;
  compositionId?: string;
  /** Override ε. Default = env or 2.0. */
  epsilon?: number;
  /**
   * Inject a still-renderer (tests). Default uses @remotion/renderer
   * renderStill against bundlePath. Returns a raw PNG Buffer.
   */
  __renderStill?: (input: {
    bundlePath: string;
    compositionId: string;
    inputProps: Record<string, unknown>;
    frame: number;
  }) => Promise<Buffer>;
  /**
   * Inject a frame decoder→feature extractor (tests). Maps a PNG buffer to a
   * fixed-length numeric feature vector (downscaled grayscale grid). Default
   * decodes the PNG and downscales. Tests pass synthetic vectors directly.
   */
  __extractFeatures?: (png: Buffer) => Promise<number[]>;
}

export interface LivenessRenderResult {
  /** 'live' = motion detected; 'static' = frames effectively identical; 'skipped' = infra failure / no signal. */
  verdict: 'live' | 'static' | 'skipped';
  /** Per-adjacent-pair mean-abs-diff (0-255). Empty when skipped. */
  pairDiffs: number[];
  /** Max of pairDiffs — the strongest motion signal across the sampled frames. */
  maxDiff: number;
  /** Frames actually sampled. */
  frames: number[];
  /** ε used. */
  epsilon: number;
  /** Wall-clock ms for the whole render+diff. */
  latencyMs: number;
}

/** Representative frames: first, middle, last (deduped, clamped, sorted). */
export function pickRepresentativeFrames(durationInFrames: number): number[] {
  const last = Math.max(0, durationInFrames - 1);
  const mid = Math.max(0, Math.min(last, Math.round(durationInFrames / 2)));
  return Array.from(new Set([0, mid, last])).sort((a, b) => a - b);
}

/**
 * Decode a PNG and downscale it to a DOWNSCALE×DOWNSCALE grayscale feature
 * vector via `sharp`. `sharp` is already present in the dependency tree (the
 * asset-gen sprite path uses it; @img/sharp-* native binaries are installed)
 * so we add NO new npm dependency (acceptance/ADR constraint). It is imported
 * lazily and its absence degrades to 'skipped' (no signal) rather than a hard
 * failure, so a missing native binary never blocks the user.
 *
 * Tests inject `__extractFeatures` directly, so the production decode path is
 * exercised by the live-smoke driver, not unit tests.
 */
async function defaultExtractFeatures(png: Buffer): Promise<number[] | null> {
  try {
    const mod = await import('sharp').catch(() => null);
    if (!mod) return null;
    const sharp = (mod as { default?: unknown }).default ?? mod;
    const grid = DOWNSCALE;
    // Resize to a fixed grid, drop alpha, take greyscale luma, raw bytes.
    const { data } = await (sharp as (b: Buffer) => {
      resize: (w: number, h: number, o: { fit: string }) => {
        greyscale: () => {
          removeAlpha: () => { raw: () => { toBuffer: (o: { resolveWithObject: boolean }) => Promise<{ data: Buffer }> } };
        };
      };
    })(png)
      .resize(grid, grid, { fit: 'fill' })
      .greyscale()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const out: number[] = new Array(grid * grid).fill(0);
    for (let i = 0; i < out.length && i < data.length; i++) {
      out[i] = data[i];
    }
    return out;
  } catch {
    return null;
  }
}

/** Mean absolute difference between two equal-length feature vectors. */
function meanAbsDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

/**
 * Stage-2 rendered liveness. Renders the representative frames, extracts
 * features, and compares adjacent pairs. NEVER throws — returns a 'skipped'
 * verdict on any failure so infra problems don't block the user.
 */
export async function checkRenderedLiveness(
  opts: LivenessRenderOptions,
): Promise<LivenessRenderResult> {
  const t0 = Date.now();
  const epsilon = opts.epsilon ?? envFloat('AI_LIVENESS_DIFF_EPSILON', DEFAULT_DIFF_EPSILON);
  const compositionId = opts.compositionId ?? 'UniversalComposition';
  const frames = pickRepresentativeFrames(opts.durationInFrames);
  const inputProps = { jsCode: opts.jsCode, params: opts.params };

  const skipped = (): LivenessRenderResult => ({
    verdict: 'skipped',
    pairDiffs: [],
    maxDiff: 0,
    frames,
    epsilon,
    latencyMs: Date.now() - t0,
  });

  // Fewer than 2 distinct frames (e.g. durationInFrames <= 1) — nothing to
  // compare, no signal.
  if (frames.length < 2) return skipped();

  const extract = opts.__extractFeatures
    ?? (async (png: Buffer) => {
      const f = await defaultExtractFeatures(png);
      if (!f) throw new Error('feature extraction unavailable');
      return f;
    });

  try {
    // Render + extract each frame.
    const features: number[][] = [];
    for (const frame of frames) {
      let png: Buffer;
      if (opts.__renderStill) {
        png = await opts.__renderStill({
          bundlePath: opts.bundlePath,
          compositionId,
          inputProps,
          frame,
        });
      } else {
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
        png = result.buffer;
      }
      features.push(await extract(png));
    }

    const pairDiffs: number[] = [];
    for (let i = 1; i < features.length; i++) {
      pairDiffs.push(meanAbsDiff(features[i - 1], features[i]));
    }
    const maxDiff = pairDiffs.length ? Math.max(...pairDiffs) : 0;

    return {
      verdict: maxDiff < epsilon ? 'static' : 'live',
      pairDiffs,
      maxDiff,
      frames,
      epsilon,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[TM-184] liveness render-diff failed, skipping (no signal):',
        err instanceof Error ? err.message : String(err),
      );
    }
    return skipped();
  }
}

// ---------------------------------------------------------------------------
// Orchestrator-facing combined verdict
// ---------------------------------------------------------------------------

export interface LivenessVerdict {
  /** True when the composition is judged static (must retry / warn). */
  isStatic: boolean;
  /** Which stage produced the verdict. */
  stage: 'ast' | 'render' | 'none';
  /** Machine reason codes (telemetry). */
  reasonCodes: string[];
  /** Human messages for the retry prompt / warning. */
  messages: string[];
  /** Render diagnostics when the render stage ran (null otherwise). */
  render: LivenessRenderResult | null;
  /** Total wall-clock ms. */
  latencyMs: number;
}

/**
 * Full gate: Stage 1 (free) short-circuits a render when the source is
 * provably static; otherwise Stage 2 renders + diffs. Designed to be called
 * with a SMALL footprint from generate/pipeline (one call). Never throws.
 *
 * @param renderInput omit to run AST-only (e.g. when no bundle is available or
 *   AI_LIVENESS_GATE_RENDER=0).
 */
export async function evaluateLiveness(
  code: string,
  renderInput?: Omit<LivenessRenderOptions, '__extractFeatures'> & {
    __extractFeatures?: LivenessRenderOptions['__extractFeatures'];
  },
): Promise<LivenessVerdict> {
  const t0 = Date.now();

  // Stage 1 — free AST filter. Short-circuit: if the source can't move, don't
  // pay the render tax.
  const astReasons = detectStaticMotionSource(code);
  if (astReasons.length > 0) {
    return {
      isStatic: true,
      stage: 'ast',
      reasonCodes: astReasons.map((r) => r.code),
      messages: astReasons.map((r) => r.message),
      render: null,
      latencyMs: Date.now() - t0,
    };
  }

  // Stage 2 — rendered diff (when enabled and a bundle is available).
  if (renderInput && isLivenessRenderEnabled()) {
    const render = await checkRenderedLiveness(renderInput);
    if (render.verdict === 'static') {
      return {
        isStatic: true,
        stage: 'render',
        reasonCodes: ['rendered-frames-identical'],
        messages: [
          `Static composition (TM-184): rendered frames ${render.frames.join('/')} are effectively identical (max cross-frame diff ${render.maxDiff.toFixed(2)} < ε ${render.epsilon}). The animation does not visibly move — bind a useCurrentFrame()-driven value to a visible property.`,
        ],
        render,
        latencyMs: Date.now() - t0,
      };
    }
    return {
      isStatic: false,
      stage: 'render',
      reasonCodes: [],
      messages: [],
      render,
      latencyMs: Date.now() - t0,
    };
  }

  return {
    isStatic: false,
    stage: 'none',
    reasonCodes: [],
    messages: [],
    render: null,
    latencyMs: Date.now() - t0,
  };
}
