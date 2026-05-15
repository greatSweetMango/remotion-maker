/**
 * TM-140 / ADR-0027 — Lottie manifest parse + on-disk integrity tests.
 * Mirrors `audio-manifest.test.ts`. The on-disk fixture is the real
 * `public/lottie/MANIFEST.json` shipped with the repo (placeholder
 * pending TM-140-spawn-1 curation), which doubles as a smoke check
 * that the placeholder stays valid as the schema evolves.
 */
import path from 'node:path';

import {
  LottieManifestError,
  parseLottieManifest,
} from '@/lib/lottie/manifest-types';
import {
  DEFAULT_LOTTIE_MANIFEST_PATH,
  hashLottieAsset,
  loadLottieManifest,
  verifyLottieCatalogueIntegrity,
} from '@/lib/lottie/manifest-loader';

const FIXTURE_PATH = path.join(process.cwd(), 'public', 'lottie', 'MANIFEST.json');

const makeAsset = (overrides: Record<string, unknown> = {}) => ({
  filename: 'sample-walk.json',
  subject: 'sample',
  motion: 'sample idle loop',
  durationFrames: 60,
  fps: 30,
  license: 'CC0-1.0',
  attribution: 'Test author',
  sha256: 'a'.repeat(64),
  ...overrides,
});

const makeManifest = (assets: Array<Record<string, unknown>> = [makeAsset()]) => ({
  version: 1,
  assets,
});

describe('parseLottieManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseLottieManifest(makeManifest());
    expect(m.assets).toHaveLength(1);
    expect(m.assets[0].subject).toBe('sample');
  });

  it('rejects non-object input', () => {
    expect(() => parseLottieManifest(null)).toThrow(LottieManifestError);
    expect(() => parseLottieManifest([])).toThrow(LottieManifestError);
  });

  it('rejects unsupported version', () => {
    expect(() => parseLottieManifest({ version: 2, assets: [makeAsset()] })).toThrow(
      /unsupported manifest version/,
    );
  });

  it('rejects empty assets list', () => {
    expect(() => parseLottieManifest(makeManifest([]))).toThrow(/must not be empty/);
  });

  it('rejects bad filename pattern', () => {
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ filename: 'BadName.JSON' })])),
    ).toThrow(/filename/);
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ filename: '../escape.json' })])),
    ).toThrow(/filename/);
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ filename: 'wrong.mp3' })])),
    ).toThrow(/filename/);
  });

  it('rejects duplicate filenames', () => {
    expect(() =>
      parseLottieManifest(
        makeManifest([makeAsset(), makeAsset({ sha256: 'b'.repeat(64) })]),
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects empty subject / motion', () => {
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ subject: '' })])),
    ).toThrow(/subject/);
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ motion: '' })])),
    ).toThrow(/motion/);
  });

  it('rejects non-positive durationFrames / fps', () => {
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ durationFrames: 0 })])),
    ).toThrow(/durationFrames/);
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ fps: -1 })])),
    ).toThrow(/fps/);
  });

  it('rejects malformed sha256', () => {
    expect(() =>
      parseLottieManifest(makeManifest([makeAsset({ sha256: 'XYZ' })])),
    ).toThrow(/sha256/);
  });
});

describe('shipped MANIFEST.json fixture', () => {
  it('default path matches public/lottie/MANIFEST.json', () => {
    expect(DEFAULT_LOTTIE_MANIFEST_PATH).toBe(FIXTURE_PATH);
  });

  it('parses the on-disk manifest', async () => {
    const m = await loadLottieManifest();
    expect(m.version).toBe(1);
    expect(m.assets.length).toBeGreaterThan(0);
  });

  it('every asset on disk matches its sha256', async () => {
    const m = await loadLottieManifest();
    const issues = await verifyLottieCatalogueIntegrity(m);
    if (issues.length > 0) {
      // Surface a readable failure for the dev who broke the catalogue.
      throw new Error(`integrity issues: ${JSON.stringify(issues, null, 2)}`);
    }
    expect(issues).toEqual([]);
  });
});

describe('hashLottieAsset', () => {
  it('returns lowercase 64-char hex sha256', () => {
    const h = hashLottieAsset(Buffer.from('hello'));
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
