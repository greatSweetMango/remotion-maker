/**
 * TM-138 — vision-guided self-critique loop tests.
 *
 * Covers:
 *   1. Happy path: judge ≥ threshold → no retry, initial returned.
 *   2. Fail path: judge < threshold → regenerate once → keep better PNG.
 *   3. Regen worse: regen scores lower → keep initial.
 *   4. Judge throws: initial returned, retried=false.
 *   5. Regen throws: initial returned, retried=false.
 *   6. AI_SELF_CRITIQUE=0: helper reports disabled (orchestrator skip).
 *   7. buildCritiquePrompt embeds the judge reasoning.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  judgeAndMaybeRegenerate,
  isSelfCritiqueEnabled,
  buildCritiquePrompt,
} from '@/lib/ai/self-critique';
import type { AssetGenStageResult } from '@/lib/ai/asset-gen-stage';
import type { ChatLikeClient } from '../../../plugin/llm-judge/src/judge';

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf00000003000100' +
    '5b5d2c8a0000000049454e44ae426082',
  'hex',
);

async function tmpInitial(): Promise<{
  initial: AssetGenStageResult;
  diskPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm138-'));
  const hash = 'a'.repeat(64);
  const diskPath = path.join(dir, `${hash}.png`);
  await fs.writeFile(diskPath, PNG_1x1);
  return {
    initial: {
      imageUrl: `/uploads/asset-gen/${hash}.png`,
      costUsd: 0.04,
      latencyMs: 12_000,
      cached: false,
      hash,
      matchedToken: '곰돌이',
    },
    diskPath,
    cleanup: async () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function makeJudgeClient(scores: number[], reasonings: string[]): ChatLikeClient {
  let call = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const idx = Math.min(call, scores.length - 1);
          // judgeVisual computes overall as round(avg(axis)*10).
          // Pick uniform axis = scores[idx]/10 so overall == scores[idx].
          const axisVal = Math.max(1, Math.min(10, Math.round(scores[idx] / 10)));
          const reasoning = reasonings[idx] ?? '';
          call++;
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

describe('TM-138 isSelfCritiqueEnabled', () => {
  const orig = process.env.AI_SELF_CRITIQUE;
  afterEach(() => {
    if (orig === undefined) delete process.env.AI_SELF_CRITIQUE;
    else process.env.AI_SELF_CRITIQUE = orig;
  });
  it('defaults to enabled', () => {
    delete process.env.AI_SELF_CRITIQUE;
    expect(isSelfCritiqueEnabled()).toBe(true);
  });
  it('respects AI_SELF_CRITIQUE=0', () => {
    process.env.AI_SELF_CRITIQUE = '0';
    expect(isSelfCritiqueEnabled()).toBe(false);
  });
});

describe('TM-138 buildCritiquePrompt', () => {
  it('embeds the judge reasoning verbatim', () => {
    const out = buildCritiquePrompt(
      '곰돌이가 초원을 걸어가는 애니메이션',
      'Image shows a brown circle, not a recognizable bear',
      { style: 'cartoon' },
    );
    expect(out).toContain('곰돌이');
    expect(out).toContain('Image shows a brown circle');
    expect(out).toContain('style: cartoon');
  });
});

describe('TM-138 judgeAndMaybeRegenerate', () => {
  it('happy path — judge ≥ threshold, no retry', async () => {
    const { initial, diskPath, cleanup } = await tmpInitial();
    try {
      const client = makeJudgeClient([80], ['Looks great']);
      const regenSpy = jest.fn();

      const result = await judgeAndMaybeRegenerate({
        prompt: '곰돌이 캐릭터',
        initial,
        initialDiskPath: diskPath,
        judgeClient: client,
        imageGenerator: regenSpy as never,
        threshold: 70,
      });

      expect(result.retried).toBe(false);
      expect(result.scores).toEqual([80]);
      expect(result.chosen).toBe(initial);
      expect(regenSpy).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('fail path — judge < threshold triggers regen, picks better', async () => {
    const { initial, diskPath, cleanup } = await tmpInitial();
    try {
      const client = makeJudgeClient(
        [40, 90],
        ['brown circle, not a bear', 'recognizable bear, soft cartoon style'],
      );
      // Sanity: judge math will round 40/10=4 → axis 4 → overall 40, and 90/10=9 → 90.
      const regenGen = jest.fn(async () => ({
        pngBytes: PNG_1x1,
        dataUrl: 'data:image/png;base64,xxx',
        costUsd: 0.04,
        latencyMs: 11_000,
        prompt: 'regen',
        size: '1024x1024',
        quality: 'low',
      }));

      const result = await judgeAndMaybeRegenerate({
        prompt: '곰돌이 캐릭터',
        initial,
        initialDiskPath: diskPath,
        judgeClient: client,
        imageGenerator: regenGen as never,
        threshold: 70,
        outDir: path.dirname(diskPath),
      });

      expect(result.retried).toBe(true);
      expect(result.scores).toEqual([40, 90]);
      expect(regenGen).toHaveBeenCalledTimes(1);
      // Regen prompt must include critique reasoning.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const passed = (regenGen.mock.calls[0] as any[])[0] as { prompt: string };
      expect(passed.prompt).toContain('brown circle');
      // Chosen = regen (90 > 40).
      expect(result.chosen.hash).toBe(`${initial.hash}-r1`);
      expect(result.chosen.imageUrl).toContain(`${initial.hash}-r1.png`);
      // Cost: 1 regen image + 2 judge calls.
      expect(result.extraCostUsd).toBeGreaterThan(0.04);
    } finally {
      await cleanup();
    }
  });

  it('regen scored lower → keeps initial', async () => {
    const { initial, diskPath, cleanup } = await tmpInitial();
    try {
      const client = makeJudgeClient([50, 30], ['weak', 'worse']);
      const regenGen = jest.fn(async () => ({
        pngBytes: PNG_1x1,
        dataUrl: 'data:image/png;base64,xxx',
        costUsd: 0.04,
        latencyMs: 11_000,
        prompt: 'r',
        size: '1024x1024',
        quality: 'low',
      }));

      const result = await judgeAndMaybeRegenerate({
        prompt: '곰돌이',
        initial,
        initialDiskPath: diskPath,
        judgeClient: client,
        imageGenerator: regenGen as never,
        threshold: 70,
        outDir: path.dirname(diskPath),
      });

      expect(result.retried).toBe(true);
      expect(result.scores).toEqual([50, 30]);
      expect(result.chosen).toBe(initial); // initial wins
    } finally {
      await cleanup();
    }
  });

  it('judge throws → returns initial, retried=false', async () => {
    const { initial, diskPath, cleanup } = await tmpInitial();
    try {
      const client: ChatLikeClient = {
        chat: { completions: { create: async () => { throw new Error('judge boom'); } } },
      };
      const regenGen = jest.fn();

      const result = await judgeAndMaybeRegenerate({
        prompt: '곰돌이',
        initial,
        initialDiskPath: diskPath,
        judgeClient: client,
        imageGenerator: regenGen as never,
      });

      expect(result.retried).toBe(false);
      expect(result.chosen).toBe(initial);
      expect(regenGen).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('regen throws → returns initial, retried=false', async () => {
    const { initial, diskPath, cleanup } = await tmpInitial();
    try {
      const client = makeJudgeClient([20], ['bad']);
      const regenGen = jest.fn(async () => { throw new Error('image-gen rate limit'); });

      const result = await judgeAndMaybeRegenerate({
        prompt: '곰돌이',
        initial,
        initialDiskPath: diskPath,
        judgeClient: client,
        imageGenerator: regenGen as never,
        threshold: 70,
        outDir: path.dirname(diskPath),
      });

      expect(result.retried).toBe(false);
      expect(result.chosen).toBe(initial);
    } finally {
      await cleanup();
    }
  });

  it('maxRetry=0 → never regenerates even on low score', async () => {
    const { initial, diskPath, cleanup } = await tmpInitial();
    try {
      const client = makeJudgeClient([10], ['terrible']);
      const regenGen = jest.fn();

      const result = await judgeAndMaybeRegenerate({
        prompt: '곰돌이',
        initial,
        initialDiskPath: diskPath,
        judgeClient: client,
        imageGenerator: regenGen as never,
        threshold: 70,
        maxRetry: 0,
      });

      expect(result.retried).toBe(false);
      expect(regenGen).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
