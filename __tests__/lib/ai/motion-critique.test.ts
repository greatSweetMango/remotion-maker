/**
 * TM-186 — multi-frame motion-critique unit tests (render-light, deterministic).
 *
 * All tests inject a stub `__renderStill` + `judgeClient` so NO real Remotion
 * render and NO real LLM call happen (mirrors the TM-184 render-light pattern;
 * jest never spins up Chrome). Covers:
 *   1. Static case (motion category < 60) → categoryFloorViolated=true (FAIL).
 *   2. Good motion (all categories ≥ 60) → categoryFloorViolated=false.
 *   3. Byte-identical frames → motion_present forced low (frozen pre-gate).
 *   4. N=3 determinism: identical judge → deltaMax=0, std=0.
 *   5. Variance surfaced when runs differ (deltaMax/std computed).
 *   6. renderStill throws → null (never blocks).
 *   7. judge throws → null (never blocks).
 *   8. buildMotionCriteria embeds the prompt + the two motion failure modes.
 *   9. frames picked are [0, last].
 */
import {
  critiqueMotion,
  buildMotionCriteria,
  MOTION_CATEGORY_MIN,
} from '@/lib/ai/composition-critique';
import type { ChatLikeClient } from '../../../plugin/llm-judge/src/judge';

const PNG_A = Buffer.from('aa', 'hex');
const PNG_B = Buffer.from('bb', 'hex');

/** Judge stub returning a fixed uniform axis value (axis 1-10 → overall*10). */
function makeJudge(axis: number, reasoning = 'ok'): ChatLikeClient {
  const v = Math.max(1, Math.min(10, Math.round(axis)));
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scores: { clarity: v, fidelity: v, aesthetic: v, intent_match: v },
                  reasoning,
                }),
              },
            },
          ],
        }),
      },
    },
  };
}

/** Judge stub whose axis value cycles per call (to exercise variance). */
function makeVaryingJudge(axisSeq: number[]): ChatLikeClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const v = Math.max(1, Math.min(10, Math.round(axisSeq[i % axisSeq.length])));
          i++;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    scores: { clarity: v, fidelity: v, aesthetic: v, intent_match: v },
                    reasoning: 'vary',
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };
}

// Alternate distinct buffers per frame so frames are NOT byte-identical
// (unless a test specifically wants the frozen pre-gate).
function alternatingRenderStill() {
  let n = 0;
  return async () => (n++ % 2 === 0 ? PNG_A : PNG_B);
}

const baseOpts = {
  prompt: '곰돌이가 초원을 걸어간다',
  jsCode: 'function GeneratedAsset() { return null; }',
  params: { imageUrl: '/uploads/asset-gen/bear.png' },
  durationInFrames: 150,
  bundlePath: '/tmp/fake-bundle',
};

describe('TM-186 buildMotionCriteria', () => {
  it('embeds the user prompt verbatim', () => {
    const c = buildMotionCriteria('곰돌이가 초원을 걸어가는 애니메이션');
    expect(c).toContain('곰돌이가 초원을 걸어가는 애니메이션');
  });
  it('encodes motion_present and motion_quality failure modes', () => {
    const c = buildMotionCriteria('x');
    expect(c).toMatch(/motion_present/i);
    expect(c).toMatch(/motion_quality/i);
    expect(c).toMatch(/frozen|nearly identical|dead animation/i);
    expect(c).toMatch(/eased|spring/i);
  });
});

describe('TM-186 critiqueMotion — ADR-0016 per-category floor', () => {
  it('static/weak motion (axis 4 → 40/100) → categoryFloorViolated=true (FAIL)', async () => {
    const result = await critiqueMotion({
      ...baseOpts,
      runs: 3,
      judgeClient: makeJudge(4, 'barely moves'),
      __renderStill: alternatingRenderStill(),
    });
    expect(result).not.toBeNull();
    expect(result!.categories.motion_present).toBe(40);
    expect(result!.categoryFloorViolated).toBe(true);
    expect(result!.worstCategory).toMatch(/motion|narrative/);
    // Determinism: identical judge across 3 runs.
    expect(result!.runs).toHaveLength(3);
    expect(result!.deltaMax).toBe(0);
    expect(result!.std).toBe(0);
  });

  it('good motion (axis 8 → 80/100) → categoryFloorViolated=false (PASS)', async () => {
    const result = await critiqueMotion({
      ...baseOpts,
      runs: 3,
      judgeClient: makeJudge(8, 'smooth eased motion'),
      __renderStill: alternatingRenderStill(),
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBe(80);
    expect(result!.categoryFloorViolated).toBe(false);
    Object.values(result!.categories).forEach((v) => expect(v).toBeGreaterThanOrEqual(MOTION_CATEGORY_MIN));
  });

  it('exactly at floor (60) does NOT violate (>= semantics)', async () => {
    const result = await critiqueMotion({
      ...baseOpts,
      runs: 1,
      judgeClient: makeJudge(6),
      __renderStill: alternatingRenderStill(),
    });
    expect(result!.categories.motion_present).toBe(60);
    expect(result!.categoryFloorViolated).toBe(false);
  });
});

describe('TM-186 critiqueMotion — frozen pre-gate', () => {
  it('byte-identical frames force motion_present low even if judge says high', async () => {
    // Judge claims axis 9 (would be 90), but identical frames → frozen.
    const result = await critiqueMotion({
      ...baseOpts,
      runs: 2,
      judgeClient: makeJudge(9, 'looks great'),
      __renderStill: async () => PNG_A, // SAME buffer for both frames
    });
    expect(result).not.toBeNull();
    expect(result!.categories.motion_present).toBe(10);
    expect(result!.categoryFloorViolated).toBe(true);
    expect(result!.worstCategory).toBe('motion_present');
    expect(result!.reasoning).toMatch(/byte-identical|frozen/i);
  });
});

describe('TM-186 critiqueMotion — variance surface (ADR-0018)', () => {
  it('surfaces deltaMax/std when judge runs differ', async () => {
    // axis cycles 5,7,6 → overall 50,70,60 → mean 60, deltaMax 20.
    const result = await critiqueMotion({
      ...baseOpts,
      runs: 3,
      judgeClient: makeVaryingJudge([5, 7, 6]),
      __renderStill: alternatingRenderStill(),
    });
    expect(result!.runs).toEqual([50, 70, 60]);
    expect(result!.deltaMax).toBe(20);
    expect(result!.std).toBeGreaterThan(0);
  });
});

describe('TM-186 critiqueMotion — never blocks', () => {
  it('renderStill throws → null', async () => {
    const result = await critiqueMotion({
      ...baseOpts,
      judgeClient: makeJudge(8),
      __renderStill: async () => {
        throw new Error('chrome missing');
      },
    });
    expect(result).toBeNull();
  });

  it('judge throws → null', async () => {
    const result = await critiqueMotion({
      ...baseOpts,
      judgeClient: {
        chat: { completions: { create: async () => { throw new Error('judge down'); } } },
      },
      __renderStill: alternatingRenderStill(),
    });
    expect(result).toBeNull();
  });
});

describe('TM-186 critiqueMotion — frame selection', () => {
  it('compares frame 0 and the last frame', async () => {
    const seen: number[] = [];
    const result = await critiqueMotion({
      ...baseOpts,
      durationInFrames: 90,
      runs: 1,
      judgeClient: makeJudge(8),
      __renderStill: async ({ frame }) => {
        seen.push(frame);
        return seen.length === 1 ? PNG_A : PNG_B;
      },
    });
    expect(seen).toEqual([0, 89]);
    expect(result!.frames).toEqual([0, 89]);
  });
});
