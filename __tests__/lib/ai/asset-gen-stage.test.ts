/**
 * TM-90 — unit tests for the asset-gen stage wrapper.
 *
 * No live OpenAI calls. Stubs `imageGenerator` via the injection seam.
 * Filesystem writes go to a per-test temp dir overridden by mocking
 * `process.cwd` so we don't pollute the actual repo's `public/uploads/`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  detectLivingEntity,
  hashAssetGenInputs,
  runAssetGenStage,
  __resetAssetGenCache,
  buildImagePrompt,
  ASSET_GEN_DIR_REL,
} from '@/lib/ai/asset-gen-stage';

const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64',
);

function makeStubGen(): jest.Mock {
  return jest.fn(async ({ prompt }: { prompt: string }) => ({
    pngBytes: TINY_PNG_BYTES,
    dataUrl: `data:image/png;base64,xxx`,
    costUsd: 0.04,
    latencyMs: 1234,
    prompt,
    size: '1024x1024',
    quality: 'low',
  }));
}

describe('TM-90 detectLivingEntity', () => {
  it.each([
    ['곰돌이 캐릭터가 초원을 걸어가는 10초 애니메이션', true, '곰돌이'],
    ['강아지가 공을 쫓아가는 애니메이션', true, '강아지'],
    ['dragon flying through clouds', true, 'dragon'],
    ['person walking in a forest', true, 'person'],
    ['girl reading a book', true, 'girl'],
    ['astronaut floating in space', true, 'astronaut'],
    ['Bar chart top 5 products by revenue', false, undefined],
    ['막대 그래프 매출 상위 10', false, undefined],
    ['fade in fade out logo 2 seconds', false, undefined],
    ['실시간 주식 시세 그래프', false, undefined],
  ])('detects %p → matched=%p', (prompt, expected, token) => {
    const hit = detectLivingEntity(prompt);
    expect(hit.matched).toBe(expected);
    if (expected) {
      expect(hit.matchedToken?.toLowerCase()).toContain(String(token).toLowerCase());
    }
  });

  it('also inspects clarify answers (subject often arrives as an answer)', () => {
    const hit = detectLivingEntity('10초 애니메이션', { subject: '곰돌이' });
    expect(hit.matched).toBe(true);
  });
});

describe('TM-90 hashAssetGenInputs', () => {
  it('is deterministic for same inputs', () => {
    const a = hashAssetGenInputs('곰돌이', { style: 'cartoon' }, 's');
    const b = hashAssetGenInputs('곰돌이', { style: 'cartoon' }, 's');
    expect(a).toBe(b);
  });
  it('changes when prompt changes', () => {
    const a = hashAssetGenInputs('곰돌이', undefined, 's');
    const b = hashAssetGenInputs('강아지', undefined, 's');
    expect(a).not.toBe(b);
  });
  it('is order-independent for answers (sorted-key canonicalisation)', () => {
    const a = hashAssetGenInputs('p', { a: 'x', b: 'y' });
    const b = hashAssetGenInputs('p', { b: 'y', a: 'x' });
    expect(a).toBe(b);
  });
  it('changes when style changes', () => {
    const a = hashAssetGenInputs('p', undefined, 'one');
    const b = hashAssetGenInputs('p', undefined, 'two');
    expect(a).not.toBe(b);
  });
});

describe('TM-90 buildImagePrompt', () => {
  it('appends answers when present', () => {
    const out = buildImagePrompt('곰돌이', { mood: '귀여움' }, 'cartoon');
    expect(out).toContain('곰돌이');
    expect(out).toContain('mood: 귀여움');
    expect(out).toContain('Style: cartoon');
  });
  it('omits answers section when none', () => {
    const out = buildImagePrompt('p', undefined, 's');
    expect(out).toBe('p. Style: s.');
  });
});

describe('TM-153 buildImagePrompt — hybrid diet (empty style suffix)', () => {
  it('omits the "Style: …" suffix when style is empty string', () => {
    const out = buildImagePrompt('곰돌이', { mood: '귀여움' }, '');
    expect(out).toBe('곰돌이 mood: 귀여움');
    expect(out).not.toContain('Style:');
  });
  it('omits the suffix when style is whitespace only', () => {
    const out = buildImagePrompt('p', undefined, '   ');
    expect(out).toBe('p');
  });
  it('preserves opt-in style when caller supplies one', () => {
    const out = buildImagePrompt('p', undefined, 'watercolor');
    expect(out).toBe('p. Style: watercolor.');
  });
});

describe('TM-90 runAssetGenStage', () => {
  let tmp: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    __resetAssetGenCache();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm90-'));
    originalCwd = process.cwd;
    // Redirect public/uploads/asset-gen to per-test temp dir.
    Object.defineProperty(process, 'cwd', {
      value: () => tmp,
      configurable: true,
    });
  });

  afterEach(async () => {
    Object.defineProperty(process, 'cwd', {
      value: originalCwd,
      configurable: true,
    });
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns null without calling generator when prompt has no living entity', async () => {
    const gen = makeStubGen();
    const out = await runAssetGenStage({
      prompt: 'Bar chart top 5 products',
      imageGenerator: gen as never,
    });
    expect(out).toBeNull();
    expect(gen).not.toHaveBeenCalled();
  });

  it('generates + persists PNG on first hit', async () => {
    const gen = makeStubGen();
    const out = await runAssetGenStage({
      prompt: '곰돌이 캐릭터 10초',
      imageGenerator: gen as never,
    });
    expect(out).not.toBeNull();
    expect(out!.cached).toBe(false);
    expect(out!.imageUrl).toMatch(/^\/uploads\/asset-gen\/[a-f0-9]{64}\.png$/);
    expect(out!.costUsd).toBe(0.04);
    expect(gen).toHaveBeenCalledTimes(1);

    const onDisk = path.join(tmp, ASSET_GEN_DIR_REL, `${out!.hash}.png`);
    const stat = await fs.stat(onDisk);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('is idempotent — second call with same inputs hits in-memory cache', async () => {
    const gen = makeStubGen();
    const a = await runAssetGenStage({
      prompt: '곰돌이 캐릭터 10초',
      imageGenerator: gen as never,
    });
    const b = await runAssetGenStage({
      prompt: '곰돌이 캐릭터 10초',
      imageGenerator: gen as never,
    });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(b!.cached).toBe(true);
    expect(b!.costUsd).toBe(0);
    expect(b!.imageUrl).toBe(a!.imageUrl);
  });

  it('hits on-disk cache after process restart simulation', async () => {
    const gen1 = makeStubGen();
    await runAssetGenStage({
      prompt: 'astronaut',
      imageGenerator: gen1 as never,
    });
    // Simulate fresh process — clear in-memory cache only.
    __resetAssetGenCache();
    const gen2 = makeStubGen();
    const out = await runAssetGenStage({
      prompt: 'astronaut',
      imageGenerator: gen2 as never,
    });
    expect(gen2).not.toHaveBeenCalled();
    expect(out!.cached).toBe(true);
  });

  it('different prompts produce different files', async () => {
    const gen = makeStubGen();
    const a = await runAssetGenStage({
      prompt: '곰돌이',
      imageGenerator: gen as never,
    });
    const b = await runAssetGenStage({
      prompt: '강아지',
      imageGenerator: gen as never,
    });
    expect(a!.imageUrl).not.toBe(b!.imageUrl);
    expect(gen).toHaveBeenCalledTimes(2);
  });
});
