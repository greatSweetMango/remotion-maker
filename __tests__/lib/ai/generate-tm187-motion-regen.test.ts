/**
 * TM-187 — generate.ts ↔ motion regen-loop wiring (render-light).
 *
 * Verifies the integration without any real Remotion render or LLM regen:
 *   - The TM-184 liveness render stage (forced via __livenessRender stub) sets
 *     a 'static' verdict → buildMotionSignalFromMetadata produces a BAD signal.
 *   - When AI_MOTION_REGEN=1, the regen loop (`__motionRegenLoop` seam) fires
 *     with that signal; its chosen asset + telemetry are applied to the
 *     response (`motionRegen` metadata present, recovered → stale warning cleared).
 *   - When AI_MOTION_REGEN is OFF (default), the loop never fires.
 *   - A 'live' verdict never triggers the loop.
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
  validateFrameDrivenMotion: jest.fn(() => []),
}));

// Avoid the real shared-bundle build (Chromium/webpack) in evaluateMotionForRegen.
jest.mock('@/lib/remotion/bundle', () => ({
  getSharedBundlePath: jest.fn(async () => '/tmp/fake-bundle'),
}));

import { chatComplete } from '@/lib/ai/client';
import { generateAsset } from '@/lib/ai/generate';
import type { AssetGenStageResult } from '@/lib/ai/asset-gen-stage';
import type { LivenessRenderResult } from '@/lib/ai/liveness-check';

const mockedChat = chatComplete as jest.MockedFunction<typeof chatComplete>;

const FRAME_DRIVEN_CODE = `const PARAMS = {
  imageUrl: "TM136_IMAGE_URL_PLACEHOLDER", // type: text
  speed: 1.0, // type: range, min: 0.1, max: 3.0
} as const;
export const GeneratedAsset = ({ imageUrl = PARAMS.imageUrl, speed = PARAMS.speed } = PARAMS) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 150], [0, 1920]);
  return (
    <AbsoluteFill style={{ backgroundColor: '#87CEEB' }}>
      <Img src={imageUrl} style={{ position: 'absolute', left: x, width: 200, height: 200, objectFit: 'contain' }} />
    </AbsoluteFill>
  );
};`;

function chatJson(code: string): string {
  return JSON.stringify({
    mode: 'generate',
    title: 'Bear Walking',
    code,
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
  });
}

function makeFakeAssetGen(): AssetGenStageResult {
  return {
    imageUrl: '/uploads/asset-gen/abc123.png',
    costUsd: 0.04,
    latencyMs: 25_000,
    cached: false,
    hash: 'abc123def4567890'.repeat(4).slice(0, 64),
    matchedToken: '곰돌이',
  };
}

const staticLiveness = (): LivenessRenderResult => ({
  verdict: 'static',
  pairDiffs: [0.3, 0.2],
  maxDiff: 0.3,
  frames: [0, 75, 149],
  epsilon: 2.0,
  latencyMs: 5,
});

const liveLiveness = (): LivenessRenderResult => ({
  verdict: 'live',
  pairDiffs: [40, 38],
  maxDiff: 40,
  frames: [0, 75, 149],
  epsilon: 2.0,
  latencyMs: 5,
});

const baseEnv = { ...process.env };
function resetEnv() {
  process.env = { ...baseEnv };
  // Pin single-shot path + force the liveness RENDER stage on (default-off in tests).
  process.env.AI_MULTI_STEP = '0';
  process.env.AI_LIVENESS_GATE = '1';
  process.env.AI_LIVENESS_GATE_RENDER = '1';
  // Keep TM-186 motion-critique out of the way unless a test opts in.
  delete process.env.AI_MOTION_CRITIQUE;
  delete process.env.AI_COMPOSITION_CRITIQUE;
}

describe('TM-187 generate ↔ motion regen-loop wiring', () => {
  beforeEach(() => {
    mockedChat.mockReset();
    resetEnv();
  });
  afterAll(() => {
    process.env = baseEnv;
  });

  it('static liveness + AI_MOTION_REGEN=1 → loop fires, telemetry applied, recovered clears warning', async () => {
    process.env.AI_MOTION_REGEN = '1';
    mockedChat.mockResolvedValue(chatJson(FRAME_DRIVEN_CODE));

    const recoveredAsset = { id: 'recovered' } as never;
    const loopSpy = jest.fn(async (loopOpts: { initialSignal: { livenessStatic: boolean } }) => ({
      chosen: recoveredAsset,
      chosenSignal: { livenessStatic: false, motionFloorViolated: false, aggregateScore: 90 },
      triggered: true,
      trigger: 'liveness-static' as const,
      attempts: 1,
      maxAttempts: 1,
      recovered: true,
      guardExhausted: false,
      extraCostUsd: 0.05,
      latencyMs: 12,
      // echo the signal so we can assert it was bad
      __seenStatic: loopOpts.initialSignal.livenessStatic,
    }));

    const result = await generateAsset('곰돌이가 초원을 걸어간다', 'sonnet', {
      answers: { style: 'cartoon' },
      __assetGenStage: jest.fn(async () => makeFakeAssetGen()),
      __livenessRender: jest.fn(async () => staticLiveness()),
      __motionRegenLoop: loopSpy as never,
    });

    expect(result.type).toBe('generate');
    if (result.type !== 'generate') return;

    // Loop was invoked with the static (bad) signal.
    expect(loopSpy).toHaveBeenCalledTimes(1);
    const passedSignal = loopSpy.mock.calls[0][0].initialSignal;
    expect(passedSignal.livenessStatic).toBe(true);

    // Telemetry attached.
    expect(result.motionRegen).toBeDefined();
    expect(result.motionRegen!.triggered).toBe(true);
    expect(result.motionRegen!.trigger).toBe('liveness-static');
    expect(result.motionRegen!.attempts).toBe(1);
    expect(result.motionRegen!.recovered).toBe(true);
    expect(result.motionRegen!.extraCostUsd).toBe(0.05);

    // Recovered → the stale TM-184 "not visibly move" warning was cleared.
    expect(result.warning).toBeUndefined();
    // Chosen asset adopted.
    expect(result.asset).toBe(recoveredAsset);
  });

  it('static liveness but AI_MOTION_REGEN unset (default off) → loop never fires', async () => {
    delete process.env.AI_MOTION_REGEN;
    mockedChat.mockResolvedValue(chatJson(FRAME_DRIVEN_CODE));
    const loopSpy = jest.fn();

    const result = await generateAsset('곰돌이가 초원을 걸어간다', 'sonnet', {
      answers: { style: 'cartoon' },
      __assetGenStage: jest.fn(async () => makeFakeAssetGen()),
      __livenessRender: jest.fn(async () => staticLiveness()),
      __motionRegenLoop: loopSpy as never,
    });

    expect(result.type).toBe('generate');
    expect(loopSpy).not.toHaveBeenCalled();
    if (result.type === 'generate') {
      expect(result.motionRegen).toBeUndefined();
      // The original TM-184 warning is still present (no regen to clear it).
      expect(result.warning).toMatch(/not visibly move/);
    }
  });

  it('live liveness → signal is good → loop never fires even with AI_MOTION_REGEN=1', async () => {
    process.env.AI_MOTION_REGEN = '1';
    mockedChat.mockResolvedValue(chatJson(FRAME_DRIVEN_CODE));
    const loopSpy = jest.fn();

    const result = await generateAsset('곰돌이가 초원을 걸어간다', 'sonnet', {
      answers: { style: 'cartoon' },
      __assetGenStage: jest.fn(async () => makeFakeAssetGen()),
      __livenessRender: jest.fn(async () => liveLiveness()),
      __motionRegenLoop: loopSpy as never,
    });

    expect(loopSpy).not.toHaveBeenCalled();
    if (result.type === 'generate') {
      expect(result.motionRegen).toBeUndefined();
    }
  });
});
