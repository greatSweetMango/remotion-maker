/**
 * TM-171 — composition-critique unit tests.
 *
 * Covers:
 *   1. Happy path: judge ≥ threshold → belowThreshold=false, metadata returned.
 *   2. Fail path: judge < threshold → belowThreshold=true, reasoning captured.
 *   3. renderStill throws → null (never blocks).
 *   4. Judge throws → null (never blocks).
 *   5. Custom frame override honored.
 *   6. AI_COMPOSITION_CRITIQUE env knob gates orchestrator (isEnabled).
 *   7. buildCompositionCriteria embeds the user prompt + RCA failure modes.
 */
import {
  critiqueComposition,
  isCompositionCritiqueEnabled,
  buildCompositionCriteria,
} from '@/lib/ai/composition-critique';
import type { ChatLikeClient } from '../../../plugin/llm-judge/src/judge';

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf00000003000100' +
    '5b5d2c8a0000000049454e44ae426082',
  'hex',
);

function makeJudgeClient(score: number, reasoning: string): ChatLikeClient {
  return {
    chat: {
      completions: {
        create: async () => {
          // judgeVisual computes overall as round(avg(axis)*10).
          // Pick uniform axis = score/10 so overall == score.
          const axisVal = Math.max(1, Math.min(10, Math.round(score / 10)));
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    scores: {
                      clarity: axisVal,
                      fidelity: axisVal,
                      aesthetic: axisVal,
                      intent_match: axisVal,
                    },
                    reasoning,
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

function makeThrowingJudgeClient(): ChatLikeClient {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error('boom: judge unavailable');
        },
      },
    },
  };
}

describe('TM-171 isCompositionCritiqueEnabled', () => {
  const orig = process.env.AI_COMPOSITION_CRITIQUE;
  afterEach(() => {
    if (orig === undefined) delete process.env.AI_COMPOSITION_CRITIQUE;
    else process.env.AI_COMPOSITION_CRITIQUE = orig;
  });
  it('defaults to disabled (opt-in)', () => {
    delete process.env.AI_COMPOSITION_CRITIQUE;
    expect(isCompositionCritiqueEnabled()).toBe(false);
  });
  it('enables when AI_COMPOSITION_CRITIQUE=1', () => {
    process.env.AI_COMPOSITION_CRITIQUE = '1';
    expect(isCompositionCritiqueEnabled()).toBe(true);
  });
  it('stays disabled for any other value (truthiness ≠ "1")', () => {
    process.env.AI_COMPOSITION_CRITIQUE = 'true';
    expect(isCompositionCritiqueEnabled()).toBe(false);
  });
});

describe('TM-171 buildCompositionCriteria', () => {
  it('embeds the user prompt verbatim', () => {
    const c = buildCompositionCriteria('곰돌이가 초원을 걸어가는 애니메이션');
    expect(c).toContain('곰돌이가 초원을 걸어가는 애니메이션');
  });
  it('encodes the RCA failure modes the judge should look for', () => {
    const c = buildCompositionCriteria('x');
    // The TM-166 RCA identified specific failure modes — make sure they're in
    // the prompt so the judge can spot them rather than scoring on vagueness.
    expect(c).toMatch(/opaque solid-color rectangle/i);
    expect(c).toMatch(/blank|crash/i);
    expect(c).toMatch(/composition/i);
  });
});

describe('TM-171 critiqueComposition', () => {
  const baseOpts = {
    prompt: '곰돌이가 초원을 걸어간다',
    jsCode: 'function GeneratedAsset() { return null; }',
    params: { imageUrl: '/uploads/asset-gen/bear.png' },
    durationInFrames: 150,
    bundlePath: '/tmp/fake-bundle',
  };

  it('happy path — score ≥ threshold returns belowThreshold=false', async () => {
    const result = await critiqueComposition({
      ...baseOpts,
      judgeClient: makeJudgeClient(80, 'composition is coherent'),
      __renderStill: async () => PNG_1x1,
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBe(80);
    expect(result!.belowThreshold).toBe(false);
    expect(result!.reasoning).toContain('coherent');
    expect(result!.frame).toBe(75); // mid of 150
    expect(result!.extraCostUsd).toBeGreaterThan(0);
  });

  it('fail path — score < threshold flags belowThreshold=true', async () => {
    const result = await critiqueComposition({
      ...baseOpts,
      threshold: 70,
      judgeClient: makeJudgeClient(40, 'purple band covers subject; layout incoherent'),
      __renderStill: async () => PNG_1x1,
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBe(40);
    expect(result!.belowThreshold).toBe(true);
    expect(result!.reasoning).toMatch(/purple/i);
  });

  it('renderStill throws → returns null (never blocks)', async () => {
    const result = await critiqueComposition({
      ...baseOpts,
      judgeClient: makeJudgeClient(85, 'unused'),
      __renderStill: async () => {
        throw new Error('chrome not installed');
      },
    });
    expect(result).toBeNull();
  });

  it('judge throws → returns null (never blocks)', async () => {
    const result = await critiqueComposition({
      ...baseOpts,
      judgeClient: makeThrowingJudgeClient(),
      __renderStill: async () => PNG_1x1,
    });
    expect(result).toBeNull();
  });

  it('honors explicit frame override', async () => {
    const result = await critiqueComposition({
      ...baseOpts,
      frame: 12,
      judgeClient: makeJudgeClient(80, 'ok'),
      __renderStill: async ({ frame }) => {
        expect(frame).toBe(12);
        return PNG_1x1;
      },
    });
    expect(result!.frame).toBe(12);
  });

  it('passes the cached bundlePath + UniversalComposition id to renderStill', async () => {
    let observedBundle = '';
    let observedId = '';
    await critiqueComposition({
      ...baseOpts,
      judgeClient: makeJudgeClient(80, 'ok'),
      __renderStill: async ({ bundlePath, compositionId }) => {
        observedBundle = bundlePath;
        observedId = compositionId;
        return PNG_1x1;
      },
    });
    expect(observedBundle).toBe('/tmp/fake-bundle');
    expect(observedId).toBe('UniversalComposition');
  });

  it('feeds jsCode + params into inputProps so the still renders the right composition', async () => {
    let observedInputProps: Record<string, unknown> = {};
    await critiqueComposition({
      ...baseOpts,
      judgeClient: makeJudgeClient(80, 'ok'),
      __renderStill: async ({ inputProps }) => {
        observedInputProps = inputProps;
        return PNG_1x1;
      },
    });
    expect(observedInputProps.jsCode).toBe(baseOpts.jsCode);
    expect(observedInputProps.params).toEqual(baseOpts.params);
  });
});
