/**
 * TM-186 — motion-critique FP telemetry + default-on gate unit tests.
 *
 * No I/O (recordMotionFp skips under the test runner) and no model calls.
 * Covers:
 *   1. Default-on gate stays OFF (must not flip without FP evidence).
 *   2. shouldRunMotionCritique env precedence (=1 on, =0 off, shared opt-in).
 *   3. buildMotionFpRecord shapes a result into a telemetry record.
 *   4. recordMotionFp is a no-op under the test runner (never throws/writes).
 *   5. computeMotionFpRate: FP rate + gate clearance math.
 */
import {
  MOTION_CRITIQUE_DEFAULT_ON,
  MOTION_CRITIQUE_FP_GATE,
  motionCritiqueDefault,
  shouldRunMotionCritique,
  buildMotionFpRecord,
  recordMotionFp,
  computeMotionFpRate,
} from '@/lib/ai/motion-critique-telemetry';
import type { MotionCritiqueResult } from '@/lib/ai/composition-critique';

const SAMPLE_RESULT: MotionCritiqueResult = {
  score: 42,
  categories: {
    motion_present: 30,
    motion_quality: 50,
    motion_polish: 45,
    narrative_coherence: 40,
  },
  categoryFloorViolated: true,
  worstCategory: 'motion_present',
  runs: [40, 44, 42],
  deltaMax: 4,
  std: 2,
  frames: [0, 149],
  reasoning: 'frozen-ish',
  latencyMs: 12,
  extraCostUsd: 0.015,
};

describe('TM-186 default-on gate', () => {
  it('is baked OFF until the FP harness proves FP<5%', () => {
    expect(MOTION_CRITIQUE_DEFAULT_ON).toBe(false);
    expect(motionCritiqueDefault()).toBe(false);
  });
  it('FP gate threshold is 5%', () => {
    expect(MOTION_CRITIQUE_FP_GATE).toBeCloseTo(0.05);
  });
});

describe('TM-186 shouldRunMotionCritique env precedence', () => {
  const keys = ['AI_MOTION_CRITIQUE', 'AI_COMPOSITION_CRITIQUE'] as const;
  const orig: Record<string, string | undefined> = {};
  beforeEach(() => keys.forEach((k) => { orig[k] = process.env[k]; delete process.env[k]; }));
  afterEach(() => keys.forEach((k) => {
    if (orig[k] === undefined) delete process.env[k]; else process.env[k] = orig[k];
  }));

  it('defaults OFF when no env set', () => {
    expect(shouldRunMotionCritique()).toBe(false);
  });
  it('AI_MOTION_CRITIQUE=1 → on', () => {
    process.env.AI_MOTION_CRITIQUE = '1';
    expect(shouldRunMotionCritique()).toBe(true);
  });
  it('AI_MOTION_CRITIQUE=0 kill-switch wins over composition opt-in', () => {
    process.env.AI_MOTION_CRITIQUE = '0';
    process.env.AI_COMPOSITION_CRITIQUE = '1';
    expect(shouldRunMotionCritique()).toBe(false);
  });
  it('shares the TM-171 composition opt-in', () => {
    process.env.AI_COMPOSITION_CRITIQUE = '1';
    expect(shouldRunMotionCritique()).toBe(true);
  });
});

describe('TM-186 buildMotionFpRecord', () => {
  it('shapes a result into a telemetry record', () => {
    const rec = buildMotionFpRecord('prompt-hash', SAMPLE_RESULT, 'scene');
    expect(rec.sampleId).toBe('prompt-hash');
    expect(rec.assetClass).toBe('scene');
    expect(rec.score).toBe(42);
    expect(rec.categoryFloorViolated).toBe(true);
    expect(rec.worstCategory).toBe('motion_present');
    expect(rec.deltaMax).toBe(4);
    expect(rec.std).toBe(2);
    expect(rec.runs).toEqual([40, 44, 42]);
    expect(rec.frames).toEqual([0, 149]);
    expect(typeof rec.ts).toBe('string');
  });
});

describe('TM-186 recordMotionFp', () => {
  it('is a no-op under the test runner (returns false, never throws)', async () => {
    const rec = buildMotionFpRecord('x', SAMPLE_RESULT);
    await expect(recordMotionFp(rec)).resolves.toBe(false);
  });
});

describe('TM-186 computeMotionFpRate', () => {
  it('counts flagged-but-good as false positives', () => {
    const out = computeMotionFpRate([
      { categoryFloorViolated: true, labelGood: true },   // FP
      { categoryFloorViolated: true, labelGood: false },  // true positive
      { categoryFloorViolated: false, labelGood: true },  // true negative
      { categoryFloorViolated: false, labelGood: false }, // false negative (not FP)
    ]);
    expect(out.total).toBe(4);
    expect(out.falsePositives).toBe(1);
    expect(out.fpRate).toBeCloseTo(0.25);
    expect(out.clearsGate).toBe(false); // 25% > 5%
  });
  it('clears the gate when FP < 5%', () => {
    const labeled = Array.from({ length: 100 }, (_, i) => ({
      categoryFloorViolated: i === 0, // 1 flag
      labelGood: i === 0,             // and it is good → 1 FP = 1%
    }));
    const out = computeMotionFpRate(labeled);
    expect(out.fpRate).toBeCloseTo(0.01);
    expect(out.clearsGate).toBe(true);
  });
  it('empty corpus does NOT clear the gate (require positive evidence)', () => {
    const out = computeMotionFpRate([]);
    expect(out.clearsGate).toBe(false);
  });
});
