/**
 * TM-188 — motion-presence scoring core (importable, side-effect free).
 *
 * Split out of motion-presence-bench.ts so the deterministic scoring logic can
 * be unit-tested under Jest WITHOUT pulling in the CLI runner's `import.meta`
 * / top-level `main()` (those are CJS-incompatible and would auto-run on
 * import). This module has NO side effects: pure functions only.
 *
 * Determinism (ADR-0018): pure arithmetic + AST regex via the TM-184 gate.
 * No model, no randomness, fixed ε / downscale / frames. The render-diff path
 * runs only through the TM-184 injection seams (no Chrome, no bundle).
 */
import {
  detectStaticMotionSource,
  checkRenderedLiveness,
  type LivenessRenderResult,
} from '@/lib/ai/liveness-check';

export interface MotionScore {
  /** Final classification used for pass-rate. */
  verdict: 'live' | 'static' | 'skipped';
  /** Which stage decided it. */
  stage: 'ast' | 'render' | 'none';
  /** AST static reason codes (empty when source looks live). */
  astReasonCodes: string[];
  /**
   * Numeric motion score in [0,100]. AST-static → 0. Render-diff → scaled
   * maxDiff (capped). Source-live-without-render → null (no render signal).
   */
  motionScore: number | null;
  /** Raw render diagnostics when the render stage ran. */
  render: LivenessRenderResult | null;
}

/** Map a render maxDiff (0-255 mean-abs) onto a 0-100 motion score. */
export function diffToMotionScore(maxDiff: number): number {
  // 25 mean-abs-diff (~10% average channel change) saturates to 100. Linear
  // below that. Deterministic, no tuning knob beyond this constant.
  const SATURATE = 25;
  return Math.max(0, Math.min(100, Math.round((maxDiff / SATURATE) * 100)));
}

/**
 * Score one composition's motion presence. AST stage first (free); if a render
 * triple is supplied (fixtures) or a real render input (live), run the diff.
 *
 * `renderTriple` is the fixtures seam: synthetic per-frame feature vectors fed
 * straight into checkRenderedLiveness via its injection hooks — no Chrome.
 */
export async function scoreMotion(
  code: string,
  renderTriple?: number[][],
): Promise<MotionScore> {
  const astReasons = detectStaticMotionSource(code);
  if (astReasons.length > 0) {
    return {
      verdict: 'static',
      stage: 'ast',
      astReasonCodes: astReasons.map((r) => r.code),
      motionScore: 0,
      render: null,
    };
  }

  if (renderTriple && renderTriple.length >= 2) {
    let call = 0;
    const render = await checkRenderedLiveness({
      jsCode: code,
      params: {},
      durationInFrames: 150,
      bundlePath: '/tmp/tm-188-fixture',
      // Mock seam: never boots a renderer; returns synthetic vectors in order.
      __renderStill: async () => Buffer.from('frame'),
      __extractFeatures: async () =>
        renderTriple[Math.min(call++, renderTriple.length - 1)],
    });
    return {
      verdict: render.verdict,
      stage: 'render',
      astReasonCodes: [],
      motionScore:
        render.verdict === 'skipped' ? null : diffToMotionScore(render.maxDiff),
      render,
    };
  }

  // Source looks live but we have no render signal (AST-only).
  return {
    verdict: 'live',
    stage: 'none',
    astReasonCodes: [],
    motionScore: null,
    render: null,
  };
}

export interface BenchRow {
  id: string;
  source: 'fixture-static' | 'fixture-live' | 'fixture-render' | 'live-corpus';
  expectStatic: boolean | null;
  verdict: 'live' | 'static' | 'skipped';
  stage: string;
  astReasonCodes: string[];
  motionScore: number | null;
  /** fixtures mode only: did the verdict match the ground-truth label? */
  classifiedCorrectly: boolean | null;
  note?: string;
  error?: string | null;
}

export function aggregate(rows: BenchRow[]) {
  const scored = rows.filter((r) => typeof r.motionScore === 'number');
  const live = rows.filter((r) => r.verdict === 'live');
  const labelled = rows.filter((r) => r.classifiedCorrectly !== null);
  const correct = labelled.filter((r) => r.classifiedCorrectly);
  return {
    n: rows.length,
    motion_present_n: live.length,
    motion_present_pct: rows.length
      ? Math.round((live.length / rows.length) * 100)
      : 0,
    motion_score_avg: scored.length
      ? Math.round(
          scored.reduce((s, r) => s + (r.motionScore as number), 0) /
            scored.length,
        )
      : null,
    classified_n: labelled.length,
    classified_correct_n: correct.length,
    classification_accuracy_pct: labelled.length
      ? Math.round((correct.length / labelled.length) * 100)
      : null,
  };
}
