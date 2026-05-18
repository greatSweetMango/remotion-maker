/**
 * TM-159 — A/B for minScenes=1 on short character prompts.
 *
 * TM-139 forces ≥2 scenes for any living-entity prompt so the multi-step
 * pipeline doesn't collapse to single-shot. But for SHORT character prompts
 * (no duration hint or ≤10s), the second scene costs ~3-4s (scene-spec
 * 2.2s + scene-code per TM-156 latency profile) and may not add narrative
 * value when the user only asked for "a bear walking".
 *
 * Default behavior remains TM-139 (minScenes=2) until the bench validates
 * ship criteria (latency faster, judge score drop <5pts). Opt-in via env
 * `AI_MIN_SCENES_SHORT_CHAR=1`.
 *
 * This test pins the gating logic in `generateAssetMultiStep`:
 *   - flag OFF + character + short      → minScenes=2 (TM-139 floor preserved)
 *   - flag ON  + character + no hint    → minScenes=1 (B variant)
 *   - flag ON  + character + ≤10s hint  → minScenes=1
 *   - flag ON  + character + >10s hint  → minScenes=2 (long-form keeps floor)
 *   - flag ON  + non-living             → minScenes=1 (unchanged)
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

// Disable asset-gen network calls.
jest.mock('@/lib/ai/asset-gen-stage', () => {
  const actual = jest.requireActual('@/lib/ai/asset-gen-stage');
  return {
    ...actual,
    runAssetGenStage: jest.fn(async () => null),
  };
});

import { chatComplete } from '@/lib/ai/client';
import { generateAssetMultiStep } from '@/lib/ai/pipeline';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

function outlineJson(sceneCount: number): string {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    name: `s${i}`,
    role: 'text-anim',
    durationInFrames: 75,
    keyElements: [],
    narrativeBeat: '',
  }));
  return JSON.stringify({
    title: 'Test Outline',
    totalDurationInFrames: scenes.reduce((a, s) => a + s.durationInFrames, 0),
    fps: 30,
    width: 1920,
    height: 1080,
    palette: { primary: '#7C3AED', background: '#0f0f17' },
    scenes,
  });
}

function firstOutlineUserContent(): string | null {
  const calls = mockedChat.mock.calls;
  for (const [arg] of calls) {
    const a = arg as { system?: string; messages?: Array<{ content?: string }> };
    if (typeof a.system === 'string' && a.system.includes('senior motion-design director')) {
      return a.messages?.[0]?.content ?? null;
    }
  }
  return null;
}

const SHORT_CHAR_PROMPT = '곰돌이가 걸어가는 애니메이션 만들어줘'; // no duration hint
const SHORT_CHAR_WITH_HINT = '곰돌이가 걸어가는 약 8초 애니메이션 만들어줘';
const LONG_CHAR_PROMPT = '곰돌이가 초원을 걸어가는 약 30초 애니메이션 만들어줘';
const DATA_VIZ_PROMPT = 'Bar chart top 5 products by revenue, purple gradient';

describe('TM-159 — minScenes A/B for short character prompts', () => {
  const prev = process.env.AI_MIN_SCENES_SHORT_CHAR;
  const prevMulti = process.env.AI_MULTI_STEP;
  beforeEach(() => {
    mockedChat.mockReset();
    delete process.env.AI_MIN_SCENES_SHORT_CHAR;
    delete process.env.AI_MULTI_STEP;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.AI_MIN_SCENES_SHORT_CHAR;
    else process.env.AI_MIN_SCENES_SHORT_CHAR = prev;
    if (prevMulti === undefined) delete process.env.AI_MULTI_STEP;
    else process.env.AI_MULTI_STEP = prevMulti;
  });

  it('A (flag OFF, default): short character prompt still gets minScenes=2 (TM-139 floor)', async () => {
    // Outline → 2 scenes; downstream calls will throw because we feed outline
    // JSON for spec calls too — we only care about the outline directive.
    mockedChat.mockResolvedValue(outlineJson(2));
    try {
      await generateAssetMultiStep(SHORT_CHAR_PROMPT, 'haiku', {
        answers: { bear_style: 'cartoon' },
        disableAssetGen: true,
      });
    } catch { /* downstream stage fails on stub — fine */ }
    const user = firstOutlineUserContent();
    expect(user).not.toBeNull();
    expect(user).toContain('TM-139');
    expect(user).toMatch(/minimum 2|at least 2/i);
  });

  it('B (flag ON): short character prompt with NO duration hint → minScenes=1, no TM-139 directive', async () => {
    process.env.AI_MIN_SCENES_SHORT_CHAR = '1';
    mockedChat.mockResolvedValue(outlineJson(1));
    try {
      await generateAssetMultiStep(SHORT_CHAR_PROMPT, 'haiku', {
        answers: { bear_style: 'cartoon' },
        disableAssetGen: true,
      });
    } catch { /* fine */ }
    const user = firstOutlineUserContent();
    expect(user).not.toBeNull();
    // No TM-139 floor directive injected — the user message should equal the
    // original prompt (no duration directive either, since prompt has no hint).
    expect(user).not.toContain('TM-139');
    expect(user).not.toContain('minimum 2');
  });

  it('B (flag ON): short character prompt with ≤10s duration hint → minScenes=1', async () => {
    process.env.AI_MIN_SCENES_SHORT_CHAR = '1';
    mockedChat.mockResolvedValue(outlineJson(1));
    try {
      await generateAssetMultiStep(SHORT_CHAR_WITH_HINT, 'haiku', {
        answers: { bear_style: 'cartoon' },
        disableAssetGen: true,
      });
    } catch { /* fine */ }
    const user = firstOutlineUserContent();
    expect(user).not.toBeNull();
    expect(user).not.toContain('TM-139');
  });

  it('B (flag ON): LONG (>10s) character prompt still keeps minScenes=2', async () => {
    process.env.AI_MIN_SCENES_SHORT_CHAR = '1';
    mockedChat.mockResolvedValue(outlineJson(3));
    try {
      await generateAssetMultiStep(LONG_CHAR_PROMPT, 'haiku', {
        answers: { bear_style: 'cartoon' },
        disableAssetGen: true,
      });
    } catch { /* fine */ }
    const user = firstOutlineUserContent();
    expect(user).not.toBeNull();
    expect(user).toContain('TM-139');
    expect(user).toMatch(/minimum 2|at least 2/i);
  });

  it('B (flag ON): non-living-entity prompt unaffected (already minScenes=1 by default)', async () => {
    process.env.AI_MIN_SCENES_SHORT_CHAR = '1';
    // Non-living + short → single-shot route; force multi-step to exercise the
    // pipeline.
    process.env.AI_MULTI_STEP = '1';
    mockedChat.mockResolvedValue(outlineJson(1));
    try {
      await generateAssetMultiStep(DATA_VIZ_PROMPT, 'haiku', {
        disableAssetGen: true,
      });
    } catch { /* fine */ }
    const user = firstOutlineUserContent();
    expect(user).not.toBeNull();
    expect(user).not.toContain('TM-139');
  });
});
