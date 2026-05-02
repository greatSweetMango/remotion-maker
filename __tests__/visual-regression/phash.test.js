// Unit tests for the perceptual-hash helpers used by the TM-75 driver.
// These run under plain `jest` and don't require a Remotion bundle, so they
// catch regressions in the comparison logic without needing the ~30s full
// regression sweep.
//
// We use dynamic `import()` so this Jest test (default CJS) can pull the .mjs
// helper module without Jest needing native ESM config flags.

const sharp = require('sharp');

let phash;
beforeAll(async () => {
  phash = await import('./phash.mjs');
});

async function makePng(rgbaFill) {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: rgbaFill,
    },
  })
    .png()
    .toBuffer();
}

describe('phash helpers', () => {
  test('sha256 is stable for identical buffers', async () => {
    const a = await makePng({ r: 200, g: 50, b: 50, alpha: 1 });
    const b = await makePng({ r: 200, g: 50, b: 50, alpha: 1 });
    expect(phash.sha256(a)).toEqual(phash.sha256(b));
  });

  test('sha256 differs for different content', async () => {
    const a = await makePng({ r: 200, g: 50, b: 50, alpha: 1 });
    const b = await makePng({ r: 50, g: 200, b: 50, alpha: 1 });
    expect(phash.sha256(a)).not.toEqual(phash.sha256(b));
  });

  test('dHash returns 16 hex chars (64-bit fingerprint)', async () => {
    const png = await makePng({ r: 128, g: 128, b: 128, alpha: 1 });
    const hash = await phash.dHash(png);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test('hamming distance is 0 for identical hashes and 64 for inverted', () => {
    expect(phash.hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(phash.hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(phash.hammingDistance('aaaa', 'ffff')).toBe(8);
  });

  test('pixelDiff ratio is 0 for identical PNGs', async () => {
    const png = await makePng({ r: 100, g: 100, b: 100, alpha: 1 });
    const { ratio } = await phash.pixelDiff(png, png);
    expect(ratio).toBe(0);
  });

  test('pixelDiff ratio > threshold for visibly different colours', async () => {
    const a = await makePng({ r: 0, g: 0, b: 0, alpha: 1 });
    const b = await makePng({ r: 255, g: 255, b: 255, alpha: 1 });
    const { ratio } = await phash.pixelDiff(a, b);
    expect(ratio).toBeGreaterThan(0.05);
  });
});
