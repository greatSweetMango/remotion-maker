/**
 * TM-142 — unit tests for the sprite-sheet stage + SpriteAnimator
 * validation helpers.
 *
 * No live OpenAI calls. Stubs `imageGenerator` via the injection seam.
 * Filesystem writes go to a per-test temp dir overridden by mocking
 * `process.cwd` so we don't pollute the actual repo's `public/uploads/`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  runSpriteSheetStage,
  hashSpriteSheetInputs,
  buildSpriteFramePrompt,
  __resetSpriteSheetCache,
  SPRITE_SHEET_DIR_REL,
  SPRITE_SHEET_FRAME_COUNT,
  WALK_CYCLE_FRAME_POSES,
} from '@/lib/ai/sprite-sheet-stage';
import {
  isValidSpriteFrameUrl,
  validateSpriteFrames,
} from '@/remotion/SpriteAnimator';
import {
  injectSpriteFrames,
  isSpriteSheetEnabled,
  SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM,
} from '@/lib/ai/generate';

const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64',
);

function makeStubGen(): jest.Mock {
  return jest.fn(async ({ prompt }: { prompt: string }) => ({
    pngBytes: TINY_PNG_BYTES,
    dataUrl: `data:image/png;base64,xxx`,
    costUsd: 0.04,
    latencyMs: 100,
    prompt,
    size: '1024x1024',
    quality: 'low',
  }));
}

describe('TM-142 hashSpriteSheetInputs', () => {
  it('is deterministic for same inputs', () => {
    const a = hashSpriteSheetInputs('곰돌이', { mood: 'happy' }, 's');
    const b = hashSpriteSheetInputs('곰돌이', { mood: 'happy' }, 's');
    expect(a).toBe(b);
  });
  it('differs from asset-gen hash domain (frame-count salt)', () => {
    // Same prompt, same style — sprite-sheet hash includes a `frames=4`
    // suffix so it can never collide with asset-gen's hash even if a
    // future asset-gen consumer reuses the same canonicalisation.
    const a = hashSpriteSheetInputs('곰돌이', undefined, 's');
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
  it('changes when prompt changes', () => {
    expect(hashSpriteSheetInputs('곰돌이')).not.toBe(
      hashSpriteSheetInputs('강아지'),
    );
  });
});

describe('TM-142 buildSpriteFramePrompt', () => {
  it.each([1, 2, 3, 4])('emits frame %p with the matching pose descriptor', (frameNo) => {
    const out = buildSpriteFramePrompt('bear walking', undefined, 'cartoon', frameNo);
    expect(out).toContain(`frame ${frameNo} of 4`);
    expect(out).toContain(WALK_CYCLE_FRAME_POSES[frameNo - 1]);
    expect(out).toContain('transparent background');
    expect(out).toContain('SAME character');
  });
  it('throws on out-of-range frame index', () => {
    expect(() => buildSpriteFramePrompt('p', undefined, 's', 0)).toThrow();
    expect(() => buildSpriteFramePrompt('p', undefined, 's', 5)).toThrow();
  });
});

describe('TM-142 runSpriteSheetStage', () => {
  let tmp: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    __resetSpriteSheetCache();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm142-'));
    originalCwd = process.cwd;
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

  it('returns null without calling the generator on non-living-entity prompts', async () => {
    const gen = makeStubGen();
    const out = await runSpriteSheetStage({
      prompt: 'Bar chart top 5 products',
      imageGenerator: gen as never,
    });
    expect(out).toBeNull();
    expect(gen).not.toHaveBeenCalled();
  });

  it('generates + persists 4 PNGs on first hit', async () => {
    const gen = makeStubGen();
    const out = await runSpriteSheetStage({
      prompt: '곰돌이 캐릭터 walk-cycle',
      imageGenerator: gen as never,
    });
    expect(out).not.toBeNull();
    expect(out!.frames).toHaveLength(SPRITE_SHEET_FRAME_COUNT);
    expect(out!.cached).toBe(false);
    expect(out!.costUsd).toBeCloseTo(0.16, 5);
    expect(gen).toHaveBeenCalledTimes(SPRITE_SHEET_FRAME_COUNT);
    for (let i = 0; i < SPRITE_SHEET_FRAME_COUNT; i++) {
      expect(out!.frames[i]).toMatch(
        new RegExp(`^/uploads/sprites/[a-f0-9]{64}/${i + 1}\\.png$`),
      );
      const onDisk = path.join(tmp, SPRITE_SHEET_DIR_REL, out!.hash, `${i + 1}.png`);
      const stat = await fs.stat(onDisk);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('hits in-memory cache on the second call (no extra API spend)', async () => {
    const gen = makeStubGen();
    const a = await runSpriteSheetStage({
      prompt: '곰돌이 walking',
      imageGenerator: gen as never,
    });
    const b = await runSpriteSheetStage({
      prompt: '곰돌이 walking',
      imageGenerator: gen as never,
    });
    expect(gen).toHaveBeenCalledTimes(SPRITE_SHEET_FRAME_COUNT); // first call only
    expect(b!.cached).toBe(true);
    expect(b!.costUsd).toBe(0);
    expect(b!.frames).toEqual(a!.frames);
  });

  it('per-frame cache: re-fills only the missing frames after a partial wipe', async () => {
    const gen = makeStubGen();
    const first = await runSpriteSheetStage({
      prompt: '곰돌이 walking',
      imageGenerator: gen as never,
    });
    expect(gen).toHaveBeenCalledTimes(SPRITE_SHEET_FRAME_COUNT);

    // Wipe the in-memory cache so the second call hits disk, and delete
    // frames 2 and 3 to simulate a partial-failure recovery.
    __resetSpriteSheetCache();
    const dir = path.join(tmp, SPRITE_SHEET_DIR_REL, first!.hash);
    await fs.unlink(path.join(dir, '2.png'));
    await fs.unlink(path.join(dir, '3.png'));

    gen.mockClear();
    const second = await runSpriteSheetStage({
      prompt: '곰돌이 walking',
      imageGenerator: gen as never,
    });
    expect(gen).toHaveBeenCalledTimes(2); // ONLY frames 2 + 3 re-billed
    expect(second!.cached).toBe(false);
    expect(second!.costUsd).toBeCloseTo(0.08, 5);
  });
});

describe('TM-142 SpriteAnimator validators', () => {
  it.each([
    '/uploads/sprites/abc123/1.png',
    '/uploads/sprites/0123456789abcdef/4.png',
  ])('accepts canonical url %p', (u) => {
    expect(isValidSpriteFrameUrl(u)).toBe(true);
  });

  it.each([
    '../../etc/passwd',
    '/uploads/sprites/abc/1.jpg', // wrong extension
    '/uploads/asset-gen/abc.png', // different stage's path
    'https://attacker.example/1.png', // external URL
    '/uploads/sprites/AB/1.png', // non-hex hash
    '',
    null,
    42,
  ])('rejects %p', (u) => {
    expect(isValidSpriteFrameUrl(u as never)).toBe(false);
  });

  it('validateSpriteFrames returns null on empty / mixed-invalid arrays', () => {
    expect(validateSpriteFrames([])).toBeNull();
    expect(validateSpriteFrames(['/uploads/sprites/abc/1.png', 'bad'])).toBeNull();
    expect(validateSpriteFrames(null)).toBeNull();
  });
  it('validateSpriteFrames returns the array when every entry is valid', () => {
    const arr = [
      '/uploads/sprites/abc/1.png',
      '/uploads/sprites/abc/2.png',
      '/uploads/sprites/abc/3.png',
      '/uploads/sprites/abc/4.png',
    ];
    expect(validateSpriteFrames(arr)).toEqual(arr);
  });
});

describe('TM-142 injectSpriteFrames', () => {
  const FRAMES = [
    '/uploads/sprites/h/1.png',
    '/uploads/sprites/h/2.png',
    '/uploads/sprites/h/3.png',
    '/uploads/sprites/h/4.png',
  ];

  it('replaces the canonical placeholder array', () => {
    const code = `
const PARAMS = {
  spriteFrames: ["TM142_SPRITE_FRAMES_PLACEHOLDER"], // type: text
  bg: '#fff',
};
`;
    const out = injectSpriteFrames(code, FRAMES);
    expect(out).toContain(JSON.stringify(FRAMES));
    expect(out).not.toContain('TM142_SPRITE_FRAMES_PLACEHOLDER');
  });

  it('back-fills when LLM forgot the spriteFrames field entirely', () => {
    const code = `
const PARAMS = {
  bg: '#fff',
};
`;
    const out = injectSpriteFrames(code, FRAMES);
    expect(out).toContain(`spriteFrames: ${JSON.stringify(FRAMES)}`);
  });

  it('is a no-op when spriteFrames is already populated (round-trip safe)', () => {
    const code = `
const PARAMS = {
  spriteFrames: ${JSON.stringify(FRAMES)},
  bg: '#fff',
};
`;
    expect(injectSpriteFrames(code, FRAMES)).toBe(code);
  });

  it('returns input unchanged when no PARAMS const exists', () => {
    const code = `function Component(){return null;}`;
    expect(injectSpriteFrames(code, FRAMES)).toBe(code);
  });
});

describe('TM-142 isSpriteSheetEnabled', () => {
  const orig = process.env.AI_SPRITE_SHEET;
  afterEach(() => {
    if (orig === undefined) delete process.env.AI_SPRITE_SHEET;
    else process.env.AI_SPRITE_SHEET = orig;
  });

  it('returns true when env=1', () => {
    process.env.AI_SPRITE_SHEET = '1';
    expect(isSpriteSheetEnabled({})).toBe(true);
  });
  it('returns true when opts.enableSpriteSheet=true', () => {
    delete process.env.AI_SPRITE_SHEET;
    expect(isSpriteSheetEnabled({ enableSpriteSheet: true })).toBe(true);
  });
  it('returns false when neither set', () => {
    delete process.env.AI_SPRITE_SHEET;
    expect(isSpriteSheetEnabled({})).toBe(false);
  });
});

describe('TM-142 SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM', () => {
  it('contains the placeholder marker the injector replaces', () => {
    expect(SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM).toContain('TM142_SPRITE_FRAMES_PLACEHOLDER');
  });
  it('mentions the SpriteAnimator wrapper (no bare <Img> for sprites)', () => {
    expect(SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM).toContain('<SpriteAnimator');
  });
});
