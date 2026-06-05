/**
 * TM-187 — Composition-level motion regen-loop (the motion line's final
 * enhancement). Applies the TM-138 PNG self-critique regen pattern at the
 * COMPOSITION level.
 *
 * Background — three sibling gates already exist on the generate path, but all
 * of them are TERMINAL (they attach telemetry + a non-blocking warning and stop):
 *   - TM-184 `evaluateLiveness` / `checkRenderedLiveness` — binary "does it move
 *     at all?" via a deterministic cross-frame pixel diff. A 'static' verdict
 *     means every rendered frame is effectively identical.
 *   - TM-186 `critiqueMotion` — qualitative motion judge (motion_present /
 *     _quality / _polish / narrative). The ADR-0016 per-category floor
 *     (`categoryFloorViolated`) flags a collapsed motion category < 60.
 *   - TM-171 `critiqueComposition` — single-frame layout judge.
 *
 * TM-171's own comment (line 38) flagged the gap: "score < threshold → return
 * critique metadata (regen is a future task)". TM-187 is that task for the
 * MOTION axis. When liveness is 'static' OR motion-critique breaches the floor,
 * we structure WHAT was wrong (which frames were identical, which category
 * collapsed, what the judge said) into a regen instruction, re-run the CODE
 * generation ONCE (the same `generateAssetSingleShotCore` path, with the
 * critique appended to the system prompt — ADR-0003 cache key stays stable
 * because the addendum is appended, not interleaved), then re-run the motion
 * gate on the new code. Keep the better of the two.
 *
 * Loop discipline (acceptance — NEVER an unbounded loop):
 *   - `maxAttempts` default 1, hard-capped at 2.
 *   - `maxExtraCostUsd` ceiling; once projected spend would exceed it we stop
 *     and attach a best-effort warning.
 *   - On exhaustion we return the BEST candidate seen with `guardExhausted=true`
 *     and a non-blocking warning, never a throw and never a silent dead video.
 *
 * ADR boundaries:
 *   - ADR-0001: generate path ONLY (the caller in generate.ts enforces this;
 *     edit never renders). This module is render-agnostic — it receives an
 *     injected `evaluateMotion` so it does no rendering itself and is unit-test
 *     friendly (mock fixtures, no Chrome, no LLM).
 *   - ADR-0002: PARAMS untouched — the regen re-runs the same generation core
 *     which already enforces the PARAMS export; we never rewrite code here.
 *   - ADR-0003: the critique is appended to the system prompt addendum so the
 *     cached system-prompt prefix is unchanged.
 *   - ADR-0016/0018: the motion gate it re-runs is itself deterministic.
 *
 * This module performs NO model call and NO render directly — both are injected
 * (`regenerate`, `evaluateMotion`) so the loop logic is deterministically
 * unit-tested with fixtures (static 1st pass → live after regen).
 */

// ---------------------------------------------------------------------------
// Env gating + loop-guard constants
// ---------------------------------------------------------------------------

/** Default regen attempts when a motion gate trips. Hard-capped at MAX_ATTEMPTS_CAP. */
const DEFAULT_MAX_ATTEMPTS = 1;
/** Absolute ceiling — never regenerate more than twice no matter the env. */
export const MAX_ATTEMPTS_CAP = 2;
/**
 * Default cost ceiling for the whole regen loop ($). One code-regen LLM call is
 * ~$0.03 and one re-evaluation (render diff + ~3 judge calls) ~$0.02, so a
 * single attempt budgets ~$0.05. Two attempts ~$0.10. Tunable via env.
 */
const DEFAULT_MAX_EXTRA_COST_USD = 0.12;
/** Approx projected cost of one regen attempt (LLM regen + motion re-eval). */
export const REGEN_ATTEMPT_COST_USD = 0.05;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Whether the composition motion regen-loop is enabled. Defaults OFF (opt-in)
 * until the live key-loop validates recovery rate, mirroring TM-171/TM-186.
 *   AI_MOTION_REGEN=1 → enable
 *   AI_MOTION_REGEN=0 → force off (incident kill-switch)
 */
export function isMotionRegenEnabled(): boolean {
  if (process.env.AI_MOTION_REGEN === '1') return true;
  if (process.env.AI_MOTION_REGEN === '0') return false;
  return false;
}

export function maxRegenAttempts(): number {
  const v = envInt('AI_MOTION_REGEN_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS);
  return Math.max(0, Math.min(MAX_ATTEMPTS_CAP, v));
}

export function maxRegenExtraCostUsd(): number {
  return Math.max(0, envFloat('AI_MOTION_REGEN_MAX_COST_USD', DEFAULT_MAX_EXTRA_COST_USD));
}

// ---------------------------------------------------------------------------
// Motion-gate signal (the shared verdict the loop reasons over)
// ---------------------------------------------------------------------------

/**
 * Normalized motion verdict the regen loop reasons over. Produced by combining
 * the TM-184 liveness verdict and the TM-186 motion-critique result. Kept
 * deliberately small + injectable so the loop is testable without rendering.
 */
export interface MotionSignal {
  /** TM-184: rendered frames effectively identical. */
  livenessStatic: boolean;
  /** TM-184: which frames were sampled (for the structured critique). */
  livenessFrames?: number[];
  /** TM-184: max cross-frame diff vs ε (for the structured critique). */
  livenessMaxDiff?: number;
  livenessEpsilon?: number;
  /** TM-186: ADR-0016 per-category floor breached. */
  motionFloorViolated: boolean;
  /** TM-186: the lowest motion category when the floor broke. */
  worstCategory?: string;
  /** TM-186: the worst category's averaged score (0-100). */
  worstCategoryScore?: number;
  /** TM-186: the motion judge's natural-language reasoning. */
  motionReasoning?: string;
  /**
   * Aggregate motion score used to pick the BETTER of two passes when neither
   * fully recovers (higher is better). For liveness-only we synthesize a
   * coarse score: static=0, live=100. For motion-critique we use its score.
   */
  aggregateScore: number;
}

/** True when this signal indicates the composition's MOTION is unacceptable. */
export function isMotionBad(sig: MotionSignal): boolean {
  return sig.livenessStatic || sig.motionFloorViolated;
}

/** Which gate(s) tripped — for telemetry's `trigger` field. */
export function motionTrigger(sig: MotionSignal): 'liveness-static' | 'motion-floor' | 'both' {
  if (sig.livenessStatic && sig.motionFloorViolated) return 'both';
  if (sig.livenessStatic) return 'liveness-static';
  return 'motion-floor';
}

// ---------------------------------------------------------------------------
// Critique structuring → regen prompt addendum
// ---------------------------------------------------------------------------

/**
 * Turn a bad-motion signal into a STRUCTURED regen instruction appended to the
 * generation system prompt. Mirrors TM-138 `buildCritiquePrompt`: keep the
 * spine intact and append a single, concrete "the previous attempt was static
 * because …, fix it by …" block so the LLM has actionable ground rather than a
 * vague "try harder".
 *
 * The structure names the two concrete failure shapes the gates detect:
 *   - frames identical / from===to: a value was computed but never bound to a
 *     visible animated property (or bound off-screen).
 *   - a collapsed motion category: motion present but not the requested action.
 */
export function buildMotionRegenAddendum(sig: MotionSignal): string {
  const lines: string[] = [
    '',
    '## TM-187 MOTION REGENERATION — the previous attempt FAILED the motion gate. Regenerate the code to FIX the motion.',
  ];

  if (sig.livenessStatic) {
    const frameStr = sig.livenessFrames && sig.livenessFrames.length
      ? ` (sampled frames ${sig.livenessFrames.join('/')})`
      : '';
    const diffStr = typeof sig.livenessMaxDiff === 'number' && typeof sig.livenessEpsilon === 'number'
      ? ` Cross-frame pixel diff was ${sig.livenessMaxDiff.toFixed(2)} (below the ε=${sig.livenessEpsilon} motion floor) — the rendered frames were effectively identical.`
      : '';
    lines.push(
      `- STATIC OUTPUT: the rendered frames did NOT visibly change${frameStr}.${diffStr}`,
      '  ROOT CAUSE is almost always one of: (a) the component never reads useCurrentFrame(); (b) an interpolate()/spring() value is computed but never bound to a VISIBLE style (transform/opacity/position) of an on-screen element; (c) from===to so the interpolation is constant; (d) the only motion is a CSS @keyframes/transition (frozen at t=0 under Remotion frame-isolated render).',
      '  FIX: drive at least one clearly visible property of the main subject from useCurrentFrame() with a non-trivial from→to range across the FULL duration, and verify the subject element actually consumes that value.',
    );
  }

  if (sig.motionFloorViolated) {
    const cat = sig.worstCategory ?? 'motion';
    const sc = typeof sig.worstCategoryScore === 'number' ? ` (scored ${sig.worstCategoryScore}/100, below the 60 floor)` : '';
    const reason = sig.motionReasoning ? ` Reviewer critique: "${sig.motionReasoning}".` : '';
    lines.push(
      `- WEAK MOTION: the "${cat}" axis collapsed${sc}.${reason}`,
      '  FIX: make the motion match the requested action with smooth easing (use spring() or an eased interpolate, not a hard linear teleport), a definite start and end, and movement of the SUBJECT (not just a background drift).',
    );
  }

  lines.push(
    'Keep everything else about the requested scene the same. Still export `const PARAMS` exactly as before (ADR-0002). Output the full corrected TSX.',
    '',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** One regenerated candidate produced by the injected `regenerate` fn. */
export interface RegenCandidate<TAsset> {
  /** The regenerated asset (whatever the caller's asset shape is). */
  asset: TAsset;
  /** $ the regeneration LLM call cost. */
  costUsd: number;
}

export interface MotionRegenLoopOptions<TAsset> {
  /** The first-pass asset (kept if regen doesn't beat it). */
  initialAsset: TAsset;
  /** The first-pass motion signal that tripped the loop. */
  initialSignal: MotionSignal;
  /**
   * Re-run generation ONCE with the critique addendum injected. Returns the new
   * asset + its LLM cost. May reject — the loop treats a throw as "regen
   * failed, keep best so far" (never blocks).
   */
  regenerate: (addendum: string, attempt: number) => Promise<RegenCandidate<TAsset>>;
  /**
   * Re-run the motion gate on a regenerated asset. Returns the new signal + the
   * $ the re-evaluation (render diff + judge) cost. May reject — treated as
   * "no signal, keep going / stop on guard".
   */
  evaluateMotion: (asset: TAsset, attempt: number) => Promise<{ signal: MotionSignal; costUsd: number }>;
  /** Override max attempts (default = env, capped at 2). */
  maxAttempts?: number;
  /** Override cost ceiling (default = env). */
  maxExtraCostUsd?: number;
  /** Override per-attempt projected cost (default = REGEN_ATTEMPT_COST_USD). */
  perAttemptCostUsd?: number;
}

export interface MotionRegenLoopResult<TAsset> {
  /** The BEST asset to serve (initial or a regeneration). */
  chosen: TAsset;
  /** The motion signal of the chosen asset. */
  chosenSignal: MotionSignal;
  /** Telemetry — see MotionRegenMetadata. */
  triggered: boolean;
  trigger: 'liveness-static' | 'motion-floor' | 'both';
  attempts: number;
  maxAttempts: number;
  recovered: boolean;
  guardExhausted: boolean;
  extraCostUsd: number;
  latencyMs: number;
  /** A non-blocking warning when the loop ran but did not fully recover. */
  warning?: string;
}

/**
 * Run the bounded motion regen loop. Pure orchestration over the two injected
 * effects (`regenerate`, `evaluateMotion`). NEVER throws; NEVER loops more than
 * `maxAttempts` (≤2); NEVER exceeds the cost ceiling. On exhaustion returns the
 * best-scoring candidate with `guardExhausted=true` + a warning.
 *
 * The caller only invokes this when `isMotionBad(initialSignal)` is already
 * true (a gate tripped) — but we re-check so a no-op signal short-circuits to a
 * non-triggered result.
 */
export async function runMotionRegenLoop<TAsset>(
  opts: MotionRegenLoopOptions<TAsset>,
): Promise<MotionRegenLoopResult<TAsset>> {
  const t0 = Date.now();
  const maxAttempts = Math.max(0, Math.min(MAX_ATTEMPTS_CAP, opts.maxAttempts ?? maxRegenAttempts()));
  const maxExtraCostUsd = opts.maxExtraCostUsd ?? maxRegenExtraCostUsd();
  const perAttemptCost = opts.perAttemptCostUsd ?? REGEN_ATTEMPT_COST_USD;
  const trigger = motionTrigger(opts.initialSignal);

  const base = (): MotionRegenLoopResult<TAsset> => ({
    chosen: opts.initialAsset,
    chosenSignal: opts.initialSignal,
    triggered: false,
    trigger,
    attempts: 0,
    maxAttempts,
    recovered: false,
    guardExhausted: false,
    extraCostUsd: 0,
    latencyMs: Date.now() - t0,
  });

  // Gate didn't actually trip, or attempts disabled → nothing to do.
  if (!isMotionBad(opts.initialSignal) || maxAttempts < 1) {
    return base();
  }

  // Track the best candidate (highest aggregateScore, with a hard preference
  // for any signal that is NOT bad).
  let best: TAsset = opts.initialAsset;
  let bestSignal: MotionSignal = opts.initialSignal;
  let extraCostUsd = 0;
  let attempts = 0;
  let guardExhausted = false;

  const isBetter = (cand: MotionSignal, incumbent: MotionSignal): boolean => {
    const candGood = !isMotionBad(cand);
    const incGood = !isMotionBad(incumbent);
    if (candGood !== incGood) return candGood; // a passing candidate always wins
    return cand.aggregateScore > incumbent.aggregateScore;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Cost guard — stop BEFORE spending if the next attempt would blow the ceiling.
    if (extraCostUsd + perAttemptCost > maxExtraCostUsd) {
      guardExhausted = true;
      break;
    }

    // Build the structured critique from the CURRENT best-known bad signal.
    const addendum = buildMotionRegenAddendum(bestSignal);

    let candidate: RegenCandidate<TAsset>;
    try {
      candidate = await opts.regenerate(addendum, attempt);
    } catch {
      // Regen LLM failed → keep best so far, stop (never block).
      guardExhausted = true;
      break;
    }
    attempts += 1;
    extraCostUsd += candidate.costUsd;

    let evald: { signal: MotionSignal; costUsd: number };
    try {
      evald = await opts.evaluateMotion(candidate.asset, attempt);
    } catch {
      // Re-eval failed → we can't prove the regen is better; keep best, stop.
      guardExhausted = true;
      break;
    }
    extraCostUsd += evald.costUsd;

    if (isBetter(evald.signal, bestSignal)) {
      best = candidate.asset;
      bestSignal = evald.signal;
    }

    // Recovered → done early.
    if (!isMotionBad(bestSignal)) break;
  }

  const recovered = !isMotionBad(bestSignal);
  // Guard counts as exhausted if we used the attempt budget OR cost-broke
  // without recovering.
  if (!recovered && attempts >= maxAttempts) guardExhausted = true;

  let warning: string | undefined;
  if (!recovered) {
    warning =
      'This animation may still not move enough — we tried to regenerate it but the result is still mostly static. ' +
      'Try editing it with a clearer motion description (e.g. "fade/slide/pulse over 3s", smoother easing, a definite start and end).';
  }

  return {
    chosen: best,
    chosenSignal: bestSignal,
    triggered: true,
    trigger,
    attempts,
    maxAttempts,
    recovered,
    guardExhausted,
    extraCostUsd: Number(extraCostUsd.toFixed(4)),
    latencyMs: Date.now() - t0,
    warning,
  };
}
