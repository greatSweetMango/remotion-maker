/**
 * TM-136 — single-shot asset-gen wiring test.
 *
 * Verifies the D1 fix from `wiki/05-reports/2026-05-15-TM-135-quality-rca-research.md`:
 *   1. Living-entity prompts (with or without clarify answers) trigger
 *      `runAssetGenStage` in the single-shot path.
 *   2. The LLM receives the TM-136 system-prompt addendum so it knows to
 *      emit `imageUrl: "TM136_IMAGE_URL_PLACEHOLDER"`.
 *   3. The post-LLM finalizer substitutes the placeholder with the real
 *      asset-gen URL and re-extracts PARAMS so the customize UI sees it.
 *   4. Non-living-entity prompts (charts, abstract motion) skip asset-gen
 *      entirely (no $0.04 spend on prompts that don't benefit).
 *   5. The `!opts.answers` guard removal means clarify-answer rounds also
 *      trigger asset-gen — the exact regression TM-135 surfaced.
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

import { chatComplete } from '@/lib/ai/client';
import { generateAsset, injectAssetImageUrl, ASSET_GEN_SYSTEM_PROMPT_ADDENDUM } from '@/lib/ai/generate';
import type { AssetGenStageResult } from '@/lib/ai/asset-gen-stage';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

// Substantive code with the TM-136 placeholder where the LLM should emit
// the real PARAMS.imageUrl entry per the addendum's instructions.
const CODE_WITH_PLACEHOLDER = `const PARAMS = {
  imageUrl: "TM136_IMAGE_URL_PLACEHOLDER", // type: text
  bearColor: "#D2691E", // type: color
  speed: 1.0,           // type: range, min: 0.1, max: 3.0
} as const;
export const GeneratedAsset = ({ imageUrl = PARAMS.imageUrl, bearColor = PARAMS.bearColor, speed = PARAMS.speed } = PARAMS) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 150], [0, 1920]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#87CEEB' }}>
      <Img src={imageUrl} style={{ position: 'absolute', left: x, width: 200, height: 200, objectFit: 'contain' }} />
    </AbsoluteFill>
  );
};`;

const CODE_WITHOUT_IMAGE_URL = `const PARAMS = {
  bearColor: "#D2691E", // type: color
  speed: 1.0,           // type: range, min: 0.1, max: 3.0
} as const;
export const GeneratedAsset = ({ bearColor = PARAMS.bearColor, speed = PARAMS.speed } = PARAMS) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 150], [0, 1920]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#87CEEB' }}>
      <div style={{ position: 'absolute', left: x, width: 100, height: 100, backgroundColor: bearColor, borderRadius: '50%' }} />
    </AbsoluteFill>
  );
};`;

function chatJson(code: string): string {
  return JSON.stringify({
    mode: 'generate',
    title: 'Cartoon Bear Walking',
    code,
    durationInFrames: 300,
    fps: 30,
    width: 1920,
    height: 1080,
  });
}

const FAKE_IMAGE_URL = '/uploads/asset-gen/abc123def456.png';

function makeFakeAssetGen(): AssetGenStageResult {
  return {
    imageUrl: FAKE_IMAGE_URL,
    costUsd: 0.04,
    latencyMs: 25_000,
    cached: false,
    hash: 'abc123def4567890'.repeat(4).slice(0, 64),
    matchedToken: '곰돌이',
  };
}

describe('TM-136 injectAssetImageUrl (pure)', () => {
  it('replaces TM136_IMAGE_URL_PLACEHOLDER with the real URL', () => {
    const out = injectAssetImageUrl(CODE_WITH_PLACEHOLDER, FAKE_IMAGE_URL);
    expect(out).toContain(FAKE_IMAGE_URL);
    expect(out).not.toContain('TM136_IMAGE_URL_PLACEHOLDER');
  });

  it('back-fills imageUrl into PARAMS when LLM ignored the addendum', () => {
    const out = injectAssetImageUrl(CODE_WITHOUT_IMAGE_URL, FAKE_IMAGE_URL);
    expect(out).toContain(`imageUrl: "${FAKE_IMAGE_URL}"`);
    expect(out).toContain('// type: text');
    // Ensure the original PARAMS members are preserved.
    expect(out).toContain('bearColor');
    expect(out).toContain('speed');
  });

  it('is a no-op when an imageUrl field already exists with a different value', () => {
    const code = `const PARAMS = { imageUrl: "/already/there.png", x: 1 } as const;\nexport const X = () => null;`;
    const out = injectAssetImageUrl(code, FAKE_IMAGE_URL);
    expect(out).toBe(code);
  });

  it('handles PARAMS missing entirely (returns input unchanged)', () => {
    const code = `export const X = () => null;`;
    const out = injectAssetImageUrl(code, FAKE_IMAGE_URL);
    expect(out).toBe(code);
  });
});

describe('TM-136 generateAsset single-shot asset-gen wiring', () => {
  // TM-139 — living-entity prompts auto-route to multi-step unless the
  // operator explicitly opts out via `AI_MULTI_STEP=0`. These tests assert
  // the single-shot wiring contract specifically, so we pin the env to the
  // explicit opt-out for the duration of the suite.
  const prevMultiStep = process.env.AI_MULTI_STEP;
  beforeAll(() => {
    process.env.AI_MULTI_STEP = '0';
  });
  afterAll(() => {
    if (prevMultiStep === undefined) delete process.env.AI_MULTI_STEP;
    else process.env.AI_MULTI_STEP = prevMultiStep;
  });
  beforeEach(() => mockedChat.mockReset());

  it('living-entity prompt triggers asset-gen and injects imageUrl into final code', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE_WITH_PLACEHOLDER));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());

    const result = await generateAsset(
      '곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘',
      'haiku',
      {
        answers: { bear_style: 'cartoon', color_palette: 'warm' },
        __assetGenStage: fakeStage as never,
      },
    );

    // 1. Asset-gen was called exactly once with the user's prompt + answers.
    expect(fakeStage).toHaveBeenCalledTimes(1);
    expect(fakeStage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('곰돌이'),
        answers: expect.objectContaining({ bear_style: 'cartoon' }),
      }),
    );

    // 2. The LLM saw the TM-136 addendum.
    const llmCall = mockedChat.mock.calls[0][0] as { system: string };
    expect(llmCall.system).toContain('ASSET-GEN IMAGE AVAILABLE (TM-136)');
    expect(llmCall.system).toContain('TM136_IMAGE_URL_PLACEHOLDER');

    // 3. The placeholder in the LLM output was substituted with the real URL.
    expect(result.type).toBe('generate');
    if (result.type === 'generate') {
      expect(result.asset.code).toContain(FAKE_IMAGE_URL);
      expect(result.asset.code).not.toContain('TM136_IMAGE_URL_PLACEHOLDER');
      expect(result.asset.code).toContain('<Img src={imageUrl}');
    }

    // 4. The asset-gen result is surfaced for telemetry.
    const enriched = result as typeof result & { assetGen?: AssetGenStageResult };
    expect(enriched.assetGen).toBeDefined();
    expect(enriched.assetGen?.imageUrl).toBe(FAKE_IMAGE_URL);
  });

  it('clarify-answers round STILL triggers asset-gen (TM-135 RCA — !opts.answers guard removed)', async () => {
    // This is the exact regression scenario from TM-135: user submits
    // clarify answers, single-shot path runs, and pre-TM-136 asset-gen
    // would NOT fire. Now it must.
    mockedChat.mockResolvedValueOnce(chatJson(CODE_WITHOUT_IMAGE_URL));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());

    const result = await generateAsset(
      '강아지가 공을 쫓아가는 애니메이션',
      'haiku',
      {
        // Mimic POST round 2 of the TM-135 reproduction.
        answers: { dog_style: 'cartoon', mood: 'cheerful' },
        __assetGenStage: fakeStage as never,
      },
    );

    expect(fakeStage).toHaveBeenCalledTimes(1);
    // Even though the LLM ignored the placeholder, the back-fill path
    // injected a PARAMS.imageUrl entry so the customize UI surfaces it.
    if (result.type === 'generate') {
      expect(result.asset.code).toContain(`imageUrl: "${FAKE_IMAGE_URL}"`);
    }
  });

  it('non-living-entity prompt (data-viz) does NOT trigger asset-gen — zero spend', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE_WITHOUT_IMAGE_URL));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());

    await generateAsset(
      'Bar chart top 5 products by revenue, purple gradient, 4s',
      'haiku',
      { __assetGenStage: fakeStage as never },
    );

    expect(fakeStage).not.toHaveBeenCalled();
    // System prompt must NOT carry the addendum either.
    const llmCall = mockedChat.mock.calls[0][0] as { system: string };
    expect(llmCall.system).not.toContain('ASSET-GEN IMAGE AVAILABLE (TM-136)');
  });

  it('asset-gen failure does not block generation — falls through to vector-only', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE_WITHOUT_IMAGE_URL));
    const failingStage = jest.fn(async () => {
      throw new Error('OPENAI_API_KEY missing');
    });

    const result = await generateAsset('곰돌이 캐릭터 10초', 'haiku', {
      // TM-136: answers required to make the prompt eligible for asset-gen
      // (round-1 clarify-only requests skip the stage to avoid $0.04 waste).
      answers: { style: 'cartoon' },
      __assetGenStage: failingStage as never,
    });

    expect(failingStage).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('generate');
    // No URL substitution attempted; addendum suppressed because asset-gen returned null.
    if (result.type === 'generate') {
      expect(result.asset.code).not.toContain('TM136_IMAGE_URL_PLACEHOLDER');
    }
    const enriched = result as typeof result & { assetGen?: AssetGenStageResult };
    expect(enriched.assetGen).toBeUndefined();
  });

  it('disableAssetGen=true bypasses the stage even on living-entity prompts', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE_WITHOUT_IMAGE_URL));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());

    await generateAsset('곰돌이 10초', 'haiku', {
      answers: { style: 'cartoon' },
      disableAssetGen: true,
      __assetGenStage: fakeStage as never,
    });

    expect(fakeStage).not.toHaveBeenCalled();
  });

  it('TM-136 — round-1 (no answers) skips asset-gen even on living-entity prompts', async () => {
    // Round 1 of a living-entity prompt always returns clarify (TM-95 narrow
    // rule). Running asset-gen on round 1 is $0.04 of guaranteed waste —
    // the customer hasn't even confirmed they want this generation yet.
    mockedChat.mockResolvedValueOnce(JSON.stringify({
      mode: 'clarify',
      questions: [{ id: 'style', question: '?', choices: [{ id: 'cartoon', label: '만화' }] }],
    }));
    // TM-105 dynamic-clarify second call — return unparseable so we fall through.
    mockedChat.mockResolvedValueOnce('not-json');
    const fakeStage = jest.fn(async () => makeFakeAssetGen());

    await generateAsset('곰돌이가 초원을 걸어가는 애니메이션', 'haiku', {
      __assetGenStage: fakeStage as never,
      // No answers → ineligible for asset-gen.
    });

    expect(fakeStage).not.toHaveBeenCalled();
  });

  it('addendum is suffix-only (preserves cache key prefix per ADR-0003)', () => {
    // The addendum must always APPEND to the system prompt — never prepend
    // — so prompt caching keeps hitting on the stable RAG/system prefix.
    expect(ASSET_GEN_SYSTEM_PROMPT_ADDENDUM.startsWith('\n')).toBe(true);
    expect(ASSET_GEN_SYSTEM_PROMPT_ADDENDUM).toContain('TM-136');
  });
});
