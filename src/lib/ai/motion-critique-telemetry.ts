/**
 * TM-186 — Motion-critique false-positive (FP) telemetry + default-on gate.
 *
 * The TM-186 task ships the motion-critique judge OFF by default (opt-in via
 * AI_COMPOSITION_CRITIQUE, same as TM-171). Flipping it ON for the live
 * generate path requires evidence that it does not WRONGLY reject good
 * compositions. ADR-0016/0018 already give us deterministic, per-category
 * scores; this module turns each motion-critique run into an append-only
 * telemetry record so the live false-positive rate can be measured, and exposes
 * the single `shouldDefaultOnMotionCritique()` decision the generate path will
 * eventually read.
 *
 * A "false positive" here = motion-critique flagged a composition as BAD
 * (categoryFloorViolated, i.e. a motion/timing category < 60) when a human /
 * golden label says the motion is actually fine. We cannot know the human label
 * at generate time, so the live path only RECORDS; FP rate is computed offline
 * by `scripts/qa/tm-186-motion-fp.mjs` against a labeled corpus.
 *
 * Default-on flip path (structured, not yet flipped):
 *   - `motionCritiqueDefault()` returns the baked-in default (currently OFF).
 *   - `shouldRunMotionCritique()` = explicit env override OR the default.
 *   - When the live FP rate measured by the harness is < FP_GATE (5%), a
 *     follow-up task flips `MOTION_CRITIQUE_DEFAULT_ON` to true (one-line
 *     change, guarded by this comment + the ADR-0016 floor wiring).
 *
 * Determinism: this module performs NO model calls. It only shapes/records the
 * result of `critiqueMotion` (which is itself ADR-0018 deterministic).
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { MotionCritiqueResult } from './composition-critique';

/**
 * The false-positive gate threshold for flipping motion-critique to default-on.
 * Acceptance: FP < 5% on the character/scene labeled corpus.
 */
export const MOTION_CRITIQUE_FP_GATE = 0.05;

/**
 * Baked-in default. Stays `false` until the live FP harness proves FP < 5% on a
 * labeled corpus (follow-up / spawned task). Flipping this one constant turns
 * motion-critique on for all character/scene generations.
 */
export const MOTION_CRITIQUE_DEFAULT_ON = false;

/** The default decision (override point for the flip). */
export function motionCritiqueDefault(): boolean {
  return MOTION_CRITIQUE_DEFAULT_ON;
}

/**
 * Whether to run motion-critique for this request. Explicit env opt-in wins;
 * otherwise the baked-in default. `AI_MOTION_CRITIQUE=0` force-disables even if
 * the default is later flipped on (incident kill-switch).
 */
export function shouldRunMotionCritique(): boolean {
  if (process.env.AI_MOTION_CRITIQUE === '0') return false;
  if (process.env.AI_MOTION_CRITIQUE === '1') return true;
  // Share the TM-171 composition-critique opt-in until default-on flips.
  if (process.env.AI_COMPOSITION_CRITIQUE === '1') return true;
  return motionCritiqueDefault();
}

/** One append-only telemetry record per motion-critique run. */
export interface MotionFpRecord {
  ts: string;
  /** Caller-supplied id (prompt hash / asset id) for offline join with labels. */
  sampleId: string;
  /** Optional asset class — only character/scene are gated for default-on. */
  assetClass?: 'character' | 'scene' | 'other';
  score: number;
  categories: MotionCritiqueResult['categories'];
  categoryFloorViolated: boolean;
  worstCategory: string;
  /** Variance surface (ADR-0018): per-run spread for noise-band auditing. */
  deltaMax: number;
  std: number;
  runs: number[];
  frames: [number, number];
}

/**
 * Shape a `critiqueMotion` result into an FP telemetry record. Pure — no I/O,
 * so it is trivially unit-testable and safe to call on every generate.
 */
export function buildMotionFpRecord(
  sampleId: string,
  result: MotionCritiqueResult,
  assetClass?: MotionFpRecord['assetClass'],
): MotionFpRecord {
  return {
    ts: new Date().toISOString(),
    sampleId,
    assetClass,
    score: result.score,
    categories: result.categories,
    categoryFloorViolated: result.categoryFloorViolated,
    worstCategory: result.worstCategory,
    deltaMax: result.deltaMax,
    std: result.std,
    runs: result.runs,
    frames: result.frames,
  };
}

/** Default JSONL ledger path (mirrors .agent-state spend ledger convention). */
export const MOTION_FP_LEDGER =
  process.env.AI_MOTION_FP_LEDGER
  ?? path.join(process.cwd(), '.agent-state', 'motion-fp-ledger.jsonl');

/**
 * Append a record to the JSONL ledger. Never throws — telemetry must never
 * block or fail a generate. Returns true on success, false on any I/O error.
 * Skipped entirely under the test runner unless AI_MOTION_FP_PERSIST=1, so unit
 * suites don't write to disk.
 */
export async function recordMotionFp(record: MotionFpRecord): Promise<boolean> {
  const inTestRunner =
    process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  if (inTestRunner && process.env.AI_MOTION_FP_PERSIST !== '1') return false;
  try {
    await mkdir(path.dirname(MOTION_FP_LEDGER), { recursive: true });
    await appendFile(MOTION_FP_LEDGER, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the false-positive rate from labeled records. A record is a false
 * positive when motion-critique flagged it bad (`categoryFloorViolated`) but
 * the golden label says the motion was actually acceptable (`labelGood=true`).
 *
 * Used by the offline harness (`scripts/qa/tm-186-motion-fp.mjs`) and unit
 * tests. Returns the FP rate and whether it clears the default-on gate.
 */
export function computeMotionFpRate(
  labeled: Array<{ categoryFloorViolated: boolean; labelGood: boolean }>,
): { total: number; falsePositives: number; fpRate: number; clearsGate: boolean } {
  const total = labeled.length;
  const falsePositives = labeled.filter((r) => r.categoryFloorViolated && r.labelGood).length;
  const fpRate = total === 0 ? 0 : falsePositives / total;
  return {
    total,
    falsePositives,
    fpRate,
    // Empty corpus does NOT clear the gate — we require positive evidence.
    clearsGate: total > 0 && fpRate < MOTION_CRITIQUE_FP_GATE,
  };
}
