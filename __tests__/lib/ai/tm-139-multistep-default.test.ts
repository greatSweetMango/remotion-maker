/**
 * TM-139 — multi-step default ON for character/scene prompts + ≥2 scenes.
 *
 * Verifies the D4 fix from `wiki/05-reports/2026-05-15-TM-135-quality-rca-research.md`:
 *   1. Living-entity prompts auto-route to multi-step even when the
 *      `AI_MULTI_STEP` env flag is unset (TM-124 prod default).
 *   2. Generic motion-graphics prompts retain the single-shot default —
 *      latency budget for 95% of traffic is preserved.
 *   3. Operators can still force single-shot via `AI_MULTI_STEP=0` even on
 *      character prompts (escape hatch for cost-sensitive bench runs).
 *   4. The outline stage refuses single-scene collapses for living-entity
 *      prompts: a ≥2-scene plan is enforced via the duration directive AND
 *      a post-validate fallback (LLM ignores directive).
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
import { generateAsset } from '@/lib/ai/generate';
import { generateOutline, type Outline } from '@/lib/ai/pipeline';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

const SUBSTANTIVE_CODE = `const PARAMS = {
  bearColor: "#D2691E", // type: color
  speed: 1.0,
} as const;
export const GeneratedAsset = ({ bearColor = PARAMS.bearColor, speed = PARAMS.speed } = PARAMS) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 150], [0, 1920]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#87CEEB' }}>
      <div style={{ position: 'absolute', left: x, width: 100, height: 100, backgroundColor: bearColor }} />
    </AbsoluteFill>
  );
};`;

function chatJson(code: string): string {
  return JSON.stringify({
    mode: 'generate',
    title: 'Test Asset',
    code,
    durationInFrames: 300,
    fps: 30,
    width: 1920,
    height: 1080,
  });
}

function outlineJson(scenes: Array<{ name: string; durationInFrames: number }>): string {
  return JSON.stringify({
    title: 'Test Outline',
    totalDurationInFrames: scenes.reduce((a, s) => a + s.durationInFrames, 0),
    fps: 30,
    width: 1920,
    height: 1080,
    palette: {
      primary: '#7C3AED',
      background: '#0f0f17',
    },
    scenes: scenes.map((s) => ({
      name: s.name,
      role: 'text-anim',
      durationInFrames: s.durationInFrames,
      keyElements: [],
      narrativeBeat: '',
    })),
  });
}

describe('TM-139 — multi-step auto-route on living-entity prompts', () => {
  const prevMultiStep = process.env.AI_MULTI_STEP;
  beforeEach(() => {
    mockedChat.mockReset();
    delete process.env.AI_MULTI_STEP;
  });
  afterAll(() => {
    if (prevMultiStep === undefined) delete process.env.AI_MULTI_STEP;
    else process.env.AI_MULTI_STEP = prevMultiStep;
  });

  it('character prompt (Korean 곰돌이) routes to multi-step even with AI_MULTI_STEP unset', async () => {
    // Multi-step makes 1 outline call + N scene-spec + N scene-code + compose.
    // We just need the first call (outline) to identify the path: outline
    // uses OUTLINE_SYSTEM_PROMPT, single-shot uses GENERATION_WITH_CLARIFY_*.
    // Return a 2-scene outline + scene-specs + scene-code stubs sufficient for
    // the pipeline to complete.
    mockedChat.mockResolvedValue(
      outlineJson([
        { name: 'intro', durationInFrames: 75 },
        { name: 'walk', durationInFrames: 75 },
      ]),
    );
    // Subsequent calls return spec/code shaped JSON. We don't need full
    // completion here — only assert the routing.
    const callsBefore = mockedChat.mock.calls.length;
    try {
      await generateAsset(
        '곰돌이가 초원을 걸어가는 약 10초 분량의 횡스크롤 애니메이션 만들어줘',
        'haiku',
        {
          answers: { bear_style: 'cartoon' },
          disableAssetGen: true,
        },
      );
    } catch {
      // Pipeline may throw downstream when later mock calls return outline
      // JSON (not scene spec). That's fine — we only need to confirm the
      // outline call happened with OUTLINE_SYSTEM_PROMPT.
    }
    // First chat call must have used the OUTLINE system prompt → confirms
    // multi-step routing. The outline prompt opens with the unique
    // "senior motion-design director" phrase, the single-shot prompt opens
    // with "RESPONSE MODE DECISION".
    const firstCall = mockedChat.mock.calls[callsBefore]?.[0] as { system: string };
    expect(firstCall.system).toContain('senior motion-design director');
    expect(firstCall.system).not.toContain('RESPONSE MODE DECISION');
  });

  it('AI_MULTI_STEP=0 forces single-shot even on character prompt (opt-out)', async () => {
    process.env.AI_MULTI_STEP = '0';
    mockedChat.mockResolvedValue(chatJson(SUBSTANTIVE_CODE));
    await generateAsset('곰돌이가 초원을 걸어가는 애니메이션', 'haiku', {
      answers: { style: 'cartoon' },
      disableAssetGen: true,
    });
    // First call must be the single-shot generation system prompt
    // (RESPONSE MODE DECISION header), NOT the outline director prompt.
    const firstCall = mockedChat.mock.calls[0][0] as { system: string };
    expect(firstCall.system).toContain('RESPONSE MODE DECISION');
    expect(firstCall.system).not.toContain('senior motion-design director');
  });

  it('non-living-entity prompt (data-viz) uses single-shot default', async () => {
    mockedChat.mockResolvedValue(chatJson(SUBSTANTIVE_CODE));
    await generateAsset('Bar chart top 5 products by revenue, purple gradient, 4s', 'haiku', {
      disableAssetGen: true,
    });
    const firstCall = mockedChat.mock.calls[0][0] as { system: string };
    expect(firstCall.system).toContain('RESPONSE MODE DECISION');
    expect(firstCall.system).not.toContain('senior motion-design director');
  });
});

describe('TM-139 — outline minScenes floor', () => {
  beforeEach(() => mockedChat.mockReset());

  it('passes minScenes=2 directive to LLM in user message', async () => {
    mockedChat.mockResolvedValue(
      outlineJson([
        { name: 'a', durationInFrames: 75 },
        { name: 'b', durationInFrames: 75 },
      ]),
    );
    await generateOutline('곰돌이 캐릭터 짧은 영상', 'haiku', { minScenes: 2 });
    const call = mockedChat.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const userContent = call.messages[0].content;
    expect(userContent).toContain('TM-139');
    expect(userContent).toMatch(/minimum 2|at least 2/i);
  });

  it('post-fixes the outline when LLM returns 1 scene despite the directive', async () => {
    // LLM ignores directive → returns 1 scene.
    mockedChat.mockResolvedValue(
      outlineJson([{ name: 'lone', durationInFrames: 150 }]),
    );
    const outline: Outline = await generateOutline(
      '강아지가 공을 쫓아가는 약 10초 영상',
      'haiku',
      { minScenes: 2 },
    );
    expect(outline.scenes.length).toBeGreaterThanOrEqual(2);
  });

  it('does not inject TM-139 directive when minScenes<=1 (no regression for motion-graphics)', async () => {
    mockedChat.mockResolvedValue(
      outlineJson([{ name: 'a', durationInFrames: 150 }]),
    );
    await generateOutline('counter 0 to 100', 'haiku');
    const call = mockedChat.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages[0].content).not.toContain('TM-139');
  });
});
