/**
 * TM-102 — Unit tests for the multi-step generation pipeline.
 *
 * We mock the AI client + sandbox + transpiler so the test stays
 * deterministic and offline. Live smoke (5 baseline cases) is in
 * `scripts/qa/tm-102-live-baseline.ts` — gated on $OPENAI_API_KEY.
 */

jest.mock('@/lib/ai/client', () => ({
  chatComplete: jest.fn(),
  getModels: () => ({ free: 'haiku', pro: 'sonnet' }),
}));
jest.mock('@/lib/remotion/transpiler', () => ({
  transpileTSX: jest.fn(async (s: string) => `/*js*/${s}`),
}));
jest.mock('@/lib/remotion/sandbox', () => ({
  validateCode: jest.fn(() => ({ valid: true, errors: [] })),
  sanitizeCode: jest.fn((s: string) => s),
}));
jest.mock('@/lib/ai/extract-params', () => ({
  extractParameters: jest.fn(() => []),
}));

import { chatComplete } from '@/lib/ai/client';
import { validateCode as mockedValidateCode } from '@/lib/remotion/sandbox';
import {
  generateOutline,
  generateSceneSpec,
  generateSceneCode,
  composeSceneCodes,
  generateAssetMultiStep,
  validateOutline,
  projectedMultiStepCostRatio,
  MULTI_STEP_COST_RATIO_WARN,
  extractDurationHint,
  planSceneCount,
  planSceneDurations,
  enforceScenePlan,
  MAX_SCENES,
  DEFAULT_FPS,
  type Outline,
} from '@/lib/ai/pipeline';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

const VALID_OUTLINE: Outline = {
  title: 'Demo Counter',
  totalDurationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
  palette: {
    primary: '#7C3AED',
    secondary: '#A78BFA',
    accent: '#F472B6',
    background: '#0f0f17',
    rationale: 'fits prompt',
  },
  scenes: [
    {
      name: 'intro',
      role: 'title-reveal',
      durationInFrames: 60,
      keyElements: ['title text'],
      narrativeBeat: 'reveal title',
    },
    {
      name: 'main',
      role: 'data-viz',
      durationInFrames: 90,
      keyElements: ['counter'],
      narrativeBeat: 'count from 0 to 100',
    },
  ],
};

const SCENE_CODE_BODY = `const Scene1Params = {
  scene1_primaryColor: "#7C3AED", // type: color
} as const;
const Scene1 = ({ scene1_primaryColor = Scene1Params.scene1_primaryColor } = Scene1Params) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1]);
  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <div style={{ color: scene1_primaryColor, opacity }}>Hello</div>
    </AbsoluteFill>
  );
};`;

describe('TM-102 pipeline — Stage 1 outline', () => {
  beforeEach(() => mockedChat.mockReset());

  it('parses a valid outline JSON', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify(VALID_OUTLINE));
    const out = await generateOutline('counter 0 to 100', 'sonnet');
    expect(out.title).toBe('Demo Counter');
    expect(out.scenes).toHaveLength(2);
    expect(out.scenes.reduce((a, b) => a + b.durationInFrames, 0)).toBe(150);
  });

  it('throws when palette is missing', () => {
    expect(() =>
      validateOutline({ title: 'x', scenes: [{ name: 's', durationInFrames: 60 }] }),
    ).toThrow(/palette/);
  });

  it('throws when scenes[] is empty', () => {
    expect(() =>
      validateOutline({
        title: 'x',
        palette: { primary: '#fff', background: '#000' },
        scenes: [],
      }),
    ).toThrow(/non-empty/);
  });

  it('rescales scene durations so they sum to total', () => {
    const out = validateOutline({
      title: 'x',
      totalDurationInFrames: 100,
      palette: { primary: '#fff', background: '#000' },
      scenes: [
        { name: 'a', role: 'text-anim', durationInFrames: 60 },
        { name: 'b', role: 'text-anim', durationInFrames: 60 },
      ],
    });
    expect(out.scenes.reduce((a, b) => a + b.durationInFrames, 0)).toBe(100);
  });

  it('caps scenes at 12 (TM-104)', () => {
    // 12 scenes is the new ceiling — should pass.
    expect(() =>
      validateOutline({
        title: 'x',
        totalDurationInFrames: 360,
        palette: { primary: '#fff', background: '#000' },
        scenes: Array.from({ length: 12 }, (_, i) => ({
          name: `s${i}`,
          role: 'text-anim',
          durationInFrames: 30,
        })),
      }),
    ).not.toThrow();
    // 13 scenes should throw.
    expect(() =>
      validateOutline({
        title: 'x',
        palette: { primary: '#fff', background: '#000' },
        scenes: Array.from({ length: 13 }, (_, i) => ({
          name: `s${i}`,
          role: 'text-anim',
          durationInFrames: 30,
        })),
      }),
    ).toThrow(/capped at 12/);
  });
});

describe('TM-102 pipeline — Stage 2 scene spec', () => {
  beforeEach(() => mockedChat.mockReset());

  it('back-fills palette from outline if scene spec omits it', async () => {
    mockedChat.mockResolvedValueOnce(
      JSON.stringify({
        name: 'intro',
        description: 'short title',
        animationType: 'spring',
        elements: [],
      }),
    );
    const spec = await generateSceneSpec(VALID_OUTLINE, 0, 'sonnet');
    expect(spec.palette).toEqual(VALID_OUTLINE.palette);
  });

  it('rejects an out-of-range scene index', async () => {
    await expect(generateSceneSpec(VALID_OUTLINE, 99, 'sonnet')).rejects.toThrow(/out of range/);
  });
});

describe('TM-102 pipeline — Stage 3 scene code', () => {
  beforeEach(() => mockedChat.mockReset());

  it('returns the sanitized code body', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify({ code: SCENE_CODE_BODY }));
    const tsx = await generateSceneCode(
      VALID_OUTLINE,
      { name: 'intro' } as never,
      0,
      'sonnet',
    );
    expect(tsx).toContain('Scene1');
    expect(tsx.length).toBeGreaterThan(100);
  });

  it('rejects code that is too short', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify({ code: 'const x = 1;' }));
    await expect(
      generateSceneCode(VALID_OUTLINE, { name: 'intro' } as never, 0, 'sonnet'),
    ).rejects.toThrow(/too short/);
  });
});

describe('TM-102 pipeline — Stage 4 composition', () => {
  it('emits a top-level PARAMS spreading per-scene params', () => {
    const composed = composeSceneCodes(VALID_OUTLINE, [SCENE_CODE_BODY, SCENE_CODE_BODY]);
    expect(composed).toContain('const PARAMS');
    expect(composed).toContain('...Scene1Params');
    expect(composed).toContain('...Scene2Params');
    // Sequence offsets correct
    expect(composed).toContain('from={0}');
    expect(composed).toContain('from={60}');
    expect(composed).toContain('durationInFrames={60}');
    expect(composed).toContain('durationInFrames={90}');
  });

  it('refuses mismatched code count', () => {
    expect(() => composeSceneCodes(VALID_OUTLINE, [SCENE_CODE_BODY])).toThrow(/scene code count/);
  });
});

describe('TM-102 pipeline — orchestrator', () => {
  beforeEach(() => mockedChat.mockReset());

  it('runs all four stages end-to-end', async () => {
    // 1× outline + 2× scene-spec + 2× scene-code = 5 calls total
    mockedChat
      .mockResolvedValueOnce(JSON.stringify(VALID_OUTLINE))
      .mockResolvedValueOnce(JSON.stringify({ name: 'intro', description: 'x' }))
      .mockResolvedValueOnce(JSON.stringify({ name: 'main', description: 'x' }))
      .mockResolvedValueOnce(JSON.stringify({ code: SCENE_CODE_BODY }))
      .mockResolvedValueOnce(JSON.stringify({ code: SCENE_CODE_BODY }));
    const result = await generateAssetMultiStep('counter 0 to 100', 'sonnet');
    expect(result.outline.title).toBe('Demo Counter');
    expect(result.sceneSpecs).toHaveLength(2);
    expect(result.composedCode).toContain('GeneratedAsset');
    expect(result.asset.durationInFrames).toBe(150);
    expect(mockedChat).toHaveBeenCalledTimes(5);
  });

  it('attaches a cost warning above the threshold', async () => {
    mockedChat
      .mockResolvedValueOnce(JSON.stringify(VALID_OUTLINE))
      .mockResolvedValueOnce(JSON.stringify({ name: 'intro' }))
      .mockResolvedValueOnce(JSON.stringify({ name: 'main' }))
      .mockResolvedValueOnce(JSON.stringify({ code: SCENE_CODE_BODY }))
      .mockResolvedValueOnce(JSON.stringify({ code: SCENE_CODE_BODY }));
    const result = await generateAssetMultiStep('counter 0 to 100', 'sonnet');
    // 2 scenes → 1.75× ≥ MULTI_STEP_COST_RATIO_WARN (1.7).
    expect(result.costRatio).toBeGreaterThanOrEqual(MULTI_STEP_COST_RATIO_WARN);
    expect(result.costWarning).toMatch(/multi-step/i);
  });
});

describe('TM-104 — duration hint extraction', () => {
  it('extracts Korean 초 (seconds)', () => {
    expect(extractDurationHint('60초 마케팅 영상').seconds).toBe(60);
    expect(extractDurationHint('짧은 10초 인트로').seconds).toBe(10);
  });

  it('extracts Korean 분 (minutes)', () => {
    expect(extractDurationHint('2분짜리 광고').seconds).toBe(120);
    expect(extractDurationHint('1분 30초 트레일러').seconds).toBe(90);
  });

  it('extracts English seconds', () => {
    expect(extractDurationHint('60 seconds intro').seconds).toBe(60);
    expect(extractDurationHint('a 30s loop').seconds).toBe(30);
    expect(extractDurationHint('120 sec marketing').seconds).toBe(120);
  });

  it('extracts English minutes', () => {
    expect(extractDurationHint('a 2 minute video').seconds).toBe(120);
    expect(extractDurationHint('2min ad').seconds).toBe(120);
  });

  it('extracts mixed mm ss', () => {
    expect(extractDurationHint('1m30s teaser').seconds).toBe(90);
    expect(extractDurationHint('2m 0s spot').seconds).toBe(120);
  });

  it('returns null when no hint', () => {
    expect(extractDurationHint('counter 0 to 100').seconds).toBeNull();
    expect(extractDurationHint('purple bar chart').seconds).toBeNull();
  });
});

describe('TM-104 — scene planning', () => {
  it('uses 1 scene for short prompts', () => {
    expect(planSceneCount(5)).toBe(1);
    expect(planSceneCount(10)).toBe(1);
  });

  it('scales scene count with duration', () => {
    expect(planSceneCount(30)).toBe(2);
    expect(planSceneCount(60)).toBe(4);
    expect(planSceneCount(120)).toBe(8);
  });

  it('caps at MAX_SCENES', () => {
    expect(planSceneCount(600)).toBe(MAX_SCENES);
    expect(planSceneCount(99999)).toBe(MAX_SCENES);
  });

  it('produces frame plan that sums to total exactly', () => {
    const plan = planSceneDurations(60, 30);
    expect(plan.totalFrames).toBe(60 * 30);
    expect(plan.fps).toBe(30);
    expect(plan.sceneFrames.reduce((a, b) => a + b, 0)).toBe(60 * 30);
    expect(plan.sceneFrames.length).toBe(planSceneCount(60));
  });

  it('120s plan produces 8 scenes summing to 3600 frames @ 30fps', () => {
    const plan = planSceneDurations(120, 30);
    expect(plan.sceneFrames.length).toBe(8);
    expect(plan.totalFrames).toBe(3600);
    expect(plan.sceneFrames.reduce((a, b) => a + b, 0)).toBe(3600);
  });

  it('falls back to default fps when 0 passed', () => {
    const plan = planSceneDurations(60, 0);
    expect(plan.fps).toBe(DEFAULT_FPS);
  });
});

describe('TM-104 — generateOutline duration handling', () => {
  beforeEach(() => mockedChat.mockReset());

  const SHORT_OUTLINE_LLM = {
    title: 'Short',
    totalDurationInFrames: 150, // 5s
    fps: 30,
    width: 1920,
    height: 1080,
    palette: { primary: '#fff', background: '#000' },
    scenes: [
      { name: 'intro', role: 'title-reveal', durationInFrames: 75 },
      { name: 'main', role: 'text-anim', durationInFrames: 75 },
    ],
  };

  it('short prompt (10s) does NOT trigger directive — outline kept as LLM returns', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify(SHORT_OUTLINE_LLM));
    const out = await generateOutline('counter 0 to 100', 'sonnet');
    expect(out.totalDurationInFrames).toBe(150);
    // The LLM was called with the raw prompt (no directive injection).
    const call = mockedChat.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages[0].content).toBe('counter 0 to 100');
  });

  it('long prompt (120s) injects DURATION DIRECTIVE into user message', async () => {
    // LLM returns the desired structure (8 scenes, 3600 frames).
    const longLLM = {
      ...SHORT_OUTLINE_LLM,
      totalDurationInFrames: 3600,
      scenes: Array.from({ length: 8 }, (_, i) => ({
        name: `s${i}`,
        role: 'text-anim' as const,
        durationInFrames: 450,
      })),
    };
    mockedChat.mockResolvedValueOnce(JSON.stringify(longLLM));
    const out = await generateOutline('120초 마케팅 영상', 'sonnet');
    const call = mockedChat.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages[0].content).toMatch(/DURATION DIRECTIVE/);
    expect(call.messages[0].content).toMatch(/totalDurationInFrames=3600/);
    expect(out.totalDurationInFrames).toBe(3600);
    expect(out.scenes.length).toBe(8);
  });

  it('post-fixes outline when LLM ignores the duration directive', async () => {
    // LLM returns a 5s outline despite a 60s prompt.
    mockedChat.mockResolvedValueOnce(JSON.stringify(SHORT_OUTLINE_LLM));
    const out = await generateOutline('60초 인트로', 'sonnet');
    expect(out.totalDurationInFrames).toBe(60 * 30); // forced
    expect(out.scenes.length).toBe(planSceneCount(60));
    expect(out.scenes.reduce((a, b) => a + b.durationInFrames, 0)).toBe(60 * 30);
  });
});

describe('TM-104 — enforceScenePlan', () => {
  it('preserves narrative names but rewrites durations to plan', () => {
    const outline: Outline = {
      title: 't',
      totalDurationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
      palette: { primary: '#fff', secondary: '#ccc', accent: '#888', background: '#000' },
      scenes: [
        { name: 'intro', role: 'title-reveal', durationInFrames: 75, keyElements: [], narrativeBeat: 'a' },
        { name: 'main', role: 'text-anim', durationInFrames: 75, keyElements: [], narrativeBeat: 'b' },
      ],
    };
    const plan = planSceneDurations(60, 30);
    const fixed = enforceScenePlan(outline, plan);
    expect(fixed.totalDurationInFrames).toBe(1800);
    expect(fixed.scenes.length).toBe(plan.sceneFrames.length);
    expect(fixed.scenes.reduce((a, b) => a + b.durationInFrames, 0)).toBe(1800);
    // First scene retains narrative
    expect(fixed.scenes[0].name).toBe('intro');
  });
});

describe('TM-111 — generateSceneCode auto-sanitize', () => {
  beforeEach(() => mockedChat.mockReset());

  // Sample gpt-4o failure mode: emits `const fs = require('fs');` plus a
  // `globalThis.useCurrentFrame()` call inside a Scene1 component.
  const GPT4O_BAD_CODE = `const fs = require('fs');
const Scene1Params = { scene1_color: "#7C3AED" } as const;
const Scene1 = ({ scene1_color = Scene1Params.scene1_color } = Scene1Params) => {
  const frame = globalThis.useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1]);
  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <div style={{ color: scene1_color, opacity }}>Hello</div>
    </AbsoluteFill>
  );
};`;

  it('passes after stripping require / globalThis (would fail real sandbox unscrubbed)', async () => {
    // Simulate REAL sandbox: invalid if require/globalThis present, else valid.
    (mockedValidateCode as jest.Mock).mockImplementation((code: string) => {
      const errors: string[] = [];
      if (/\brequire\s*\(/.test(code)) errors.push('Forbidden: require');
      if (/\bglobalThis\b/.test(code)) errors.push('Forbidden: globalThis');
      return { valid: errors.length === 0, errors };
    });

    mockedChat.mockResolvedValueOnce(JSON.stringify({ code: GPT4O_BAD_CODE }));
    const tsx = await generateSceneCode(
      VALID_OUTLINE,
      { name: 'intro' } as never,
      0,
      'gpt-4o',
    );
    expect(tsx).not.toMatch(/\brequire\s*\(/);
    expect(tsx).not.toMatch(/\bglobalThis\b/);
    expect(tsx).toMatch(/Scene1/);

    // Reset to default for subsequent tests.
    (mockedValidateCode as jest.Mock).mockImplementation(() => ({ valid: true, errors: [] }));
  });

  it('still throws SceneSandboxError when the sanitizer cannot remove the violation', async () => {
    const { SceneSandboxError } = await import('@/lib/ai/pipeline');

    (mockedValidateCode as jest.Mock).mockImplementation(() => ({
      valid: false,
      errors: ['Forbidden: eval'],
    }));

    const codeWithEval = `${SCENE_CODE_BODY}\n// eval('1+1');`;
    mockedChat.mockResolvedValueOnce(JSON.stringify({ code: codeWithEval }));
    await expect(
      generateSceneCode(VALID_OUTLINE, { name: 'intro' } as never, 0, 'gpt-4o'),
    ).rejects.toBeInstanceOf(SceneSandboxError);

    (mockedValidateCode as jest.Mock).mockImplementation(() => ({ valid: true, errors: [] }));
  });
});

describe('TM-111 — generateAssetMultiStepAsApiResponse single-shot fallback', () => {
  beforeEach(() => mockedChat.mockReset());

  it('falls back to single-shot generate when multi-step throws a sandbox error', async () => {
    // Force the multi-step pipeline to fail on the FIRST stage (outline)
    // so we don't need to mock the entire fan-out. The fallback path
    // should kick in regardless of which stage failed.
    mockedChat.mockRejectedValueOnce(new Error('TM-102 outline: AI did not return valid JSON'));

    // Fallback path calls generateAsset → which dynamically imports
    // from generate.ts. We mock generateAsset by intercepting the
    // dynamic import via Jest's module registry.
    const fakeFallback = {
      type: 'generate' as const,
      asset: {
        id: 'fallback-id',
        title: 'Fallback Asset',
        code: 'const PARAMS = {} as const;\nconst GeneratedAsset = () => <AbsoluteFill />;',
        jsCode: '/*js*/',
        parameters: [],
        durationInFrames: 150,
        fps: 30,
        width: 1920,
        height: 1080,
      },
    };
    jest.doMock('@/lib/ai/generate', () => ({
      generateAsset: jest.fn(async () => fakeFallback),
    }));

    const { generateAssetMultiStepAsApiResponse } = await import('@/lib/ai/pipeline');
    const result = await generateAssetMultiStepAsApiResponse('counter 0 to 100', 'gpt-4o');
    expect(result.type).toBe('generate');
    if (result.type !== 'generate') throw new Error('expected generate');
    expect(result.asset.id).toBe('fallback-id');
    expect(result.warning).toMatch(/TM-111/);
    expect(result.multiStep?.fallback).toBe('single-shot');

    jest.dontMock('@/lib/ai/generate');
  });
});

describe('TM-111 — sanitizeForbiddenTokens', () => {
  // sanitizeForbiddenTokens is exported from pipeline.ts at the top of this file;
  // import via dynamic import to keep it co-located with the rest of TM-111 tests.
  let sanitizeForbiddenTokens: typeof import('@/lib/ai/pipeline').sanitizeForbiddenTokens;
  beforeAll(async () => {
    ({ sanitizeForbiddenTokens } = await import('@/lib/ai/pipeline'));
  });

  it('strips `const x = require(...)` declarations', () => {
    const input = `const fs = require('fs');\nconst Scene1 = () => null;`;
    const { code, notes } = sanitizeForbiddenTokens(input);
    expect(code).not.toMatch(/require\s*\(/);
    expect(notes.join(' ')).toMatch(/require/);
  });

  it('rewrites `globalThis.X` to bare X', () => {
    const input = `const f = globalThis.useCurrentFrame();\nconst v = globalThis['interpolate'];`;
    const { code, notes } = sanitizeForbiddenTokens(input);
    expect(code).not.toMatch(/globalThis/);
    expect(code).toMatch(/useCurrentFrame\(\)/);
    expect(code).toMatch(/=\s*interpolate;/);
    expect(notes.join(' ')).toMatch(/globalThis/);
  });

  it('replaces dynamic import(...) with undefined', () => {
    const input = `const m = await import('react');`;
    const { code } = sanitizeForbiddenTokens(input);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).toMatch(/undefined/);
  });

  it('replaces new Function(...) with arrow null', () => {
    const input = `const fn = new Function('return 1');`;
    const { code } = sanitizeForbiddenTokens(input);
    expect(code).not.toMatch(/new\s+Function\s*\(/);
    expect(code).toMatch(/=>\s*null/);
  });

  it('strips process.env references', () => {
    const input = `const env = process.env;`;
    const { code } = sanitizeForbiddenTokens(input);
    expect(code).not.toMatch(/\bprocess\s*\./);
    expect(code).toMatch(/undefined/);
  });

  it('returns empty notes on clean code (no-op path)', () => {
    const input = `const Scene1 = () => <AbsoluteFill />;`;
    const { code, notes } = sanitizeForbiddenTokens(input);
    expect(code).toBe(input);
    expect(notes).toEqual([]);
  });
});

describe('TM-102 — cost projection', () => {
  it('grows monotonically with scene count', () => {
    const r1 = projectedMultiStepCostRatio(1);
    const r2 = projectedMultiStepCostRatio(2);
    const r3 = projectedMultiStepCostRatio(3);
    expect(r1).toBeLessThan(r2);
    expect(r2).toBeLessThan(r3);
    // sanity bounds anchored to ADR docstring (1 ≈ 1.4×, 3 ≈ 2.0×)
    expect(r1).toBeCloseTo(1.35, 1);
    expect(r3).toBeCloseTo(2.15, 1);
  });
});
