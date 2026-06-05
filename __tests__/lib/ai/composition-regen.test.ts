/**
 * TM-187 — composition motion regen-loop unit tests (render-light, deterministic).
 *
 * The loop is driven by two INJECTED effects (`regenerate`, `evaluateMotion`)
 * so NO real LLM regen and NO Remotion render ever run here (mirrors the TM-184
 * / TM-186 render-light pattern). Fixtures: static 1st pass → live after regen.
 *
 * Acceptance coverage:
 *   1. Static 1st pass that recovers after exactly 1 regen → recovered=true,
 *      attempts=1, chosen = regen asset (deterministic).
 *   2. Loop-guard: persistent static, maxAttempts exhausted → guardExhausted,
 *      warning attached, best-effort returned, NEVER more than maxAttempts.
 *   3. Cost ceiling stops the loop BEFORE overspending.
 *   4. A passing initial signal short-circuits (triggered=false, 0 attempts).
 *   5. maxAttempts hard-capped at 2 even if env asks for more.
 *   6. regenerate throws → keeps incumbent, never blocks.
 *   7. evaluateMotion throws → keeps incumbent, never blocks.
 *   8. Picks the higher-aggregateScore candidate when neither fully recovers.
 *   9. buildMotionRegenAddendum structures the critique (frames, category).
 *  10. trigger classification (liveness / motion / both).
 */
import {
  runMotionRegenLoop,
  buildMotionRegenAddendum,
  isMotionBad,
  motionTrigger,
  MAX_ATTEMPTS_CAP,
  type MotionSignal,
} from '@/lib/ai/composition-regen';

const STATIC: MotionSignal = {
  livenessStatic: true,
  livenessFrames: [0, 75, 149],
  livenessMaxDiff: 0.4,
  livenessEpsilon: 2.0,
  motionFloorViolated: false,
  aggregateScore: 0,
};

const FLOOR_BREACH: MotionSignal = {
  livenessStatic: false,
  motionFloorViolated: true,
  worstCategory: 'motion_present',
  worstCategoryScore: 30,
  motionReasoning: 'barely moves',
  aggregateScore: 35,
};

const LIVE: MotionSignal = {
  livenessStatic: false,
  motionFloorViolated: false,
  aggregateScore: 85,
};

const INITIAL_ASSET = { id: 'a0', jsCode: 'static' };
const REGEN_ASSET = { id: 'a1', jsCode: 'moving' };

describe('TM-187 isMotionBad / motionTrigger', () => {
  it('static or floor-breach is bad; live is good', () => {
    expect(isMotionBad(STATIC)).toBe(true);
    expect(isMotionBad(FLOOR_BREACH)).toBe(true);
    expect(isMotionBad(LIVE)).toBe(false);
  });
  it('classifies the trigger', () => {
    expect(motionTrigger(STATIC)).toBe('liveness-static');
    expect(motionTrigger(FLOOR_BREACH)).toBe('motion-floor');
    expect(motionTrigger({ ...STATIC, motionFloorViolated: true })).toBe('both');
  });
});

describe('TM-187 buildMotionRegenAddendum', () => {
  it('structures the static critique with sampled frames + diff', () => {
    const a = buildMotionRegenAddendum(STATIC);
    expect(a).toMatch(/TM-187 MOTION REGENERATION/);
    expect(a).toMatch(/STATIC OUTPUT/);
    expect(a).toContain('0/75/149');
    expect(a).toMatch(/useCurrentFrame/);
    expect(a).toMatch(/PARAMS/); // ADR-0002 reminder preserved
  });
  it('structures the motion-floor critique with category + reasoning', () => {
    const a = buildMotionRegenAddendum(FLOOR_BREACH);
    expect(a).toMatch(/WEAK MOTION/);
    expect(a).toContain('motion_present');
    expect(a).toContain('30/100');
    expect(a).toContain('barely moves');
  });
});

describe('TM-187 runMotionRegenLoop — recovery', () => {
  it('static 1st pass recovers after exactly 1 regen (deterministic)', async () => {
    const regenerate = jest.fn(async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }));
    const evaluateMotion = jest.fn(async () => ({ signal: LIVE, costUsd: 0.02 }));

    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate,
      evaluateMotion,
      maxAttempts: 1,
      maxExtraCostUsd: 0.12,
    });

    expect(res.triggered).toBe(true);
    expect(res.trigger).toBe('liveness-static');
    expect(res.attempts).toBe(1);
    expect(res.recovered).toBe(true);
    expect(res.guardExhausted).toBe(false);
    expect(res.chosen).toBe(REGEN_ASSET);
    expect(res.warning).toBeUndefined();
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(res.extraCostUsd).toBeCloseTo(0.05, 4);
  });

  it('floor-breach recovers after 1 regen', async () => {
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: FLOOR_BREACH,
      regenerate: async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }),
      evaluateMotion: async () => ({ signal: LIVE, costUsd: 0.02 }),
      maxAttempts: 2,
    });
    expect(res.recovered).toBe(true);
    expect(res.attempts).toBe(1); // stops early on recovery, doesn't use attempt 2
    expect(res.chosen).toBe(REGEN_ASSET);
  });
});

describe('TM-187 runMotionRegenLoop — loop guard', () => {
  it('persistent static: exhausts maxAttempts, warns, never loops past the cap', async () => {
    const regenerate = jest.fn(async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }));
    const evaluateMotion = jest.fn(async () => ({ signal: STATIC, costUsd: 0.02 }));

    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate,
      evaluateMotion,
      maxAttempts: 2,
      maxExtraCostUsd: 1.0, // high — let attempts, not cost, be the limit
    });

    expect(res.attempts).toBe(2);
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(res.recovered).toBe(false);
    expect(res.guardExhausted).toBe(true);
    expect(res.warning).toMatch(/still not move enough|mostly static/);
  });

  it('cost ceiling stops BEFORE overspending', async () => {
    const regenerate = jest.fn(async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }));
    const evaluateMotion = jest.fn(async () => ({ signal: STATIC, costUsd: 0.02 }));

    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate,
      evaluateMotion,
      maxAttempts: 2,
      perAttemptCostUsd: 0.05,
      maxExtraCostUsd: 0.06, // only room for ONE attempt (2nd would project to 0.10 > 0.06)
    });

    expect(res.attempts).toBe(1);
    expect(res.guardExhausted).toBe(true);
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('hard-caps attempts at 2 even when env/opts ask for more', async () => {
    const regenerate = jest.fn(async () => ({ asset: REGEN_ASSET, costUsd: 0.001 }));
    const evaluateMotion = jest.fn(async () => ({ signal: STATIC, costUsd: 0.001 }));
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate,
      evaluateMotion,
      maxAttempts: 99,
      maxExtraCostUsd: 100,
    });
    expect(res.maxAttempts).toBe(MAX_ATTEMPTS_CAP);
    expect(res.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS_CAP);
    expect(regenerate).toHaveBeenCalledTimes(MAX_ATTEMPTS_CAP);
  });
});

describe('TM-187 runMotionRegenLoop — short-circuit + never-block', () => {
  it('a passing initial signal does not trigger the loop', async () => {
    const regenerate = jest.fn();
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: LIVE,
      regenerate,
      evaluateMotion: jest.fn(),
      maxAttempts: 2,
    });
    expect(res.triggered).toBe(false);
    expect(res.attempts).toBe(0);
    expect(res.chosen).toBe(INITIAL_ASSET);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('maxAttempts=0 disables regen entirely', async () => {
    const regenerate = jest.fn();
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate,
      evaluateMotion: jest.fn(),
      maxAttempts: 0,
    });
    expect(res.triggered).toBe(false);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('regenerate throws → keeps incumbent, guardExhausted, never blocks', async () => {
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate: async () => { throw new Error('LLM down'); },
      evaluateMotion: jest.fn(),
      maxAttempts: 2,
    });
    expect(res.chosen).toBe(INITIAL_ASSET);
    expect(res.attempts).toBe(0);
    expect(res.guardExhausted).toBe(true);
    expect(res.recovered).toBe(false);
  });

  it('evaluateMotion throws → keeps incumbent, never blocks', async () => {
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate: async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }),
      evaluateMotion: async () => { throw new Error('render crash'); },
      maxAttempts: 2,
    });
    // We can't prove the regen is better, so we keep the incumbent.
    expect(res.chosen).toBe(INITIAL_ASSET);
    expect(res.guardExhausted).toBe(true);
  });
});

describe('TM-187 runMotionRegenLoop — best-of when not fully recovered', () => {
  it('keeps the higher-aggregateScore candidate', async () => {
    // 1st pass static (score 0). Regen still floor-breaches but scores 55 — better.
    const improved: MotionSignal = { ...FLOOR_BREACH, aggregateScore: 55 };
    const res = await runMotionRegenLoop({
      initialAsset: INITIAL_ASSET,
      initialSignal: STATIC,
      regenerate: async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }),
      evaluateMotion: async () => ({ signal: improved, costUsd: 0.02 }),
      maxAttempts: 1,
    });
    expect(res.recovered).toBe(false);
    expect(res.chosen).toBe(REGEN_ASSET); // better-but-still-bad beats the original static
    expect(res.warning).toBeDefined();
  });

  it('keeps the ORIGINAL when the regen is worse', async () => {
    const worse: MotionSignal = { ...STATIC, aggregateScore: 0 };
    const res = await runMotionRegenLoop({
      initialAsset: { id: 'a0', jsCode: 'static', aggregateScore: 10 } as never,
      initialSignal: { ...FLOOR_BREACH, aggregateScore: 40 },
      regenerate: async () => ({ asset: REGEN_ASSET, costUsd: 0.03 }),
      evaluateMotion: async () => ({ signal: worse, costUsd: 0.02 }),
      maxAttempts: 1,
    });
    // regen scored 0 < incumbent 40 → keep incumbent.
    expect(res.chosenSignal.aggregateScore).toBe(40);
  });
});
