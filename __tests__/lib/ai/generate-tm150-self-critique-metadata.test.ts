/**
 * TM-150 — self-critique judge score exposed on GenerateApiResponse.selfCritique.
 *
 * TM-149 verification could not distinguish a no-op pass-through from an
 * actual judge call because the score never escaped the server. This suite
 * pins the contract that when TM-138 runs, the response carries:
 *   - selfCritique.score: best score across attempts
 *   - selfCritique.retried: true iff regen fired
 *   - selfCritique.threshold: the cutoff (env or default 70)
 *   - selfCritique.runs: per-attempt [{score, ms}]
 *   - selfCritique.extraCostUsd: sum of judge + regen $
 *
 * The single-shot path is pinned (AI_MULTI_STEP=0) and the asset-gen stage
 * + self-critique fn are stubbed so the test is hermetic (no OpenAI, no FS).
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
import { generateAsset } from '@/lib/ai/generate';
import type { AssetGenStageResult } from '@/lib/ai/asset-gen-stage';
import type { SelfCritiqueResult } from '@/lib/ai/self-critique';
import type { SelfCritiqueMetadata } from '@/types';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

const CODE = `const PARAMS = {
  imageUrl: "TM136_IMAGE_URL_PLACEHOLDER", // type: text
} as const;
export const GeneratedAsset = ({ imageUrl = PARAMS.imageUrl } = PARAMS) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill><Img src={imageUrl} /></AbsoluteFill>;
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

describe('TM-150 generateAsset → GenerateApiResponse.selfCritique metadata', () => {
  const prevMultiStep = process.env.AI_MULTI_STEP;
  beforeAll(() => {
    process.env.AI_MULTI_STEP = '0';
  });
  afterAll(() => {
    if (prevMultiStep === undefined) delete process.env.AI_MULTI_STEP;
    else process.env.AI_MULTI_STEP = prevMultiStep;
  });
  beforeEach(() => mockedChat.mockReset());

  it('surfaces score / runs / threshold / extraCostUsd when judge passes on first attempt', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());
    const fakeCritique = jest.fn(async (input: { initial: AssetGenStageResult }): Promise<SelfCritiqueResult> => ({
      chosen: input.initial,
      scores: [85],
      reasoning: ['matches subject and palette'],
      retried: false,
      extraCostUsd: 0.005,
      latenciesMs: [1234],
      threshold: 70,
    }));

    const result = await generateAsset('곰돌이가 초원을 걸어가는 애니메이션', 'haiku', {
      answers: { bear_style: 'cartoon' },
      __assetGenStage: fakeStage as never,
      __selfCritique: fakeCritique as never,
    });

    expect(fakeCritique).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('generate');
    const meta = (result as typeof result & { selfCritique?: SelfCritiqueMetadata }).selfCritique;
    expect(meta).toBeDefined();
    expect(meta!.score).toBe(85);
    expect(meta!.retried).toBe(false);
    expect(meta!.threshold).toBe(70);
    expect(meta!.runs).toEqual([{ score: 85, ms: 1234 }]);
    expect(meta!.extraCostUsd).toBeCloseTo(0.005, 4);
  });

  it('exposes regen runs and picks the max score when retried=true', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());
    const fakeCritique = jest.fn(async (input: { initial: AssetGenStageResult }): Promise<SelfCritiqueResult> => ({
      chosen: input.initial,
      scores: [40, 90],
      reasoning: ['wrong subject', 'matches'],
      retried: true,
      extraCostUsd: 0.045,
      latenciesMs: [2200, 28_500],
      threshold: 70,
    }));

    const result = await generateAsset('곰돌이 10초', 'haiku', {
      answers: { style: 'cartoon' },
      __assetGenStage: fakeStage as never,
      __selfCritique: fakeCritique as never,
    });

    const meta = (result as typeof result & { selfCritique?: SelfCritiqueMetadata }).selfCritique;
    expect(meta).toBeDefined();
    expect(meta!.retried).toBe(true);
    expect(meta!.score).toBe(90); // max(40, 90)
    expect(meta!.runs).toEqual([
      { score: 40, ms: 2200 },
      { score: 90, ms: 28_500 },
    ]);
    expect(meta!.extraCostUsd).toBeCloseTo(0.045, 4);
  });

  it('omits selfCritique field when self-critique was skipped (no scores recorded)', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());
    // Stub with empty scores simulates judge-fail-before-billing path.
    const fakeCritique = jest.fn(async (input: { initial: AssetGenStageResult }): Promise<SelfCritiqueResult> => ({
      chosen: input.initial,
      scores: [],
      reasoning: [],
      retried: false,
      extraCostUsd: 0,
      latenciesMs: [],
      threshold: 70,
    }));

    const result = await generateAsset('곰돌이 10초', 'haiku', {
      answers: { style: 'cartoon' },
      __assetGenStage: fakeStage as never,
      __selfCritique: fakeCritique as never,
    });

    const meta = (result as typeof result & { selfCritique?: SelfCritiqueMetadata }).selfCritique;
    expect(meta).toBeUndefined();
  });

  it('omits selfCritique field on non-living-entity prompts (loop never runs)', async () => {
    mockedChat.mockResolvedValueOnce(chatJson(CODE));
    const fakeStage = jest.fn(async () => makeFakeAssetGen());
    const fakeCritique = jest.fn();

    const result = await generateAsset(
      'Bar chart top 5 products by revenue, purple gradient, 4s',
      'haiku',
      {
        __assetGenStage: fakeStage as never,
        __selfCritique: fakeCritique as never,
      },
    );

    expect(fakeStage).not.toHaveBeenCalled();
    expect(fakeCritique).not.toHaveBeenCalled();
    const meta = (result as typeof result & { selfCritique?: SelfCritiqueMetadata }).selfCritique;
    expect(meta).toBeUndefined();
  });
});
