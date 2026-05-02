// Perceptual hashing + image diff for TM-75 visual regression.
//
// Why two metrics:
//   1. **sha256** of the full PNG byte stream — exact-match channel. Catches
//      "did anything change at all?" with near-zero false positives. Useful
//      for reporting + dedupe.
//   2. **dHash on a 9x8 grayscale downscale** — perceptual channel. Robust
//      to encoder noise / 1-bit dithering / sub-pixel shifts; produces a
//      64-bit fingerprint we can Hamming-distance against the baseline.
//   3. **per-pixel diff on a 64x36 grayscale downscale** — gives a fractional
//      "drift score" we can threshold against (5% ≈ 115 of 2304 pixels).
//
// Dependencies: `sharp` (already in the tree, transitive from Remotion).
// No new deps — keeps install footprint at 0 per spec.

import { createHash } from 'node:crypto';
import sharp from 'sharp';

const HASH_W = 9;
const HASH_H = 8;
const DIFF_W = 64;
const DIFF_H = 36;
// Per-pixel grayscale delta below this is treated as encoder noise (not a real change).
const PIXEL_NOISE_THRESHOLD = 12; // 0..255

/**
 * SHA-256 of a buffer, hex-encoded.
 */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Compute dHash (difference hash) on a 9x8 grayscale downscale.
 * Returns a hex string of 16 chars (64 bits).
 */
export async function dHash(pngBuffer) {
  const raw = await sharp(pngBuffer)
    .resize(HASH_W, HASH_H, { fit: 'fill', kernel: 'lanczos3' })
    .grayscale()
    .raw()
    .toBuffer();

  // Compare adjacent pixels in each row; bit=1 if left > right.
  const bits = [];
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      const i = y * HASH_W + x;
      bits.push(raw[i] > raw[i + 1] ? 1 : 0);
    }
  }
  // Pack into hex.
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * Hamming distance between two hex hashes of equal length. Returns the
 * number of differing bits.
 */
export function hammingDistance(hexA, hexB) {
  if (hexA.length !== hexB.length) throw new Error('hash length mismatch');
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    let xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

/**
 * Pixel-level diff on a downscaled grayscale.
 * Returns { ratio, changedPixels, totalPixels } where ratio is in [0, 1].
 */
export async function pixelDiff(pngA, pngB) {
  const opts = { fit: 'fill', kernel: 'lanczos3' };
  const [a, b] = await Promise.all([
    sharp(pngA).resize(DIFF_W, DIFF_H, opts).grayscale().raw().toBuffer(),
    sharp(pngB).resize(DIFF_W, DIFF_H, opts).grayscale().raw().toBuffer(),
  ]);
  const total = DIFF_W * DIFF_H;
  let changed = 0;
  for (let i = 0; i < total; i++) {
    if (Math.abs(a[i] - b[i]) > PIXEL_NOISE_THRESHOLD) changed++;
  }
  return { ratio: changed / total, changedPixels: changed, totalPixels: total };
}

export const HASH_BITS = (HASH_W - 1) * HASH_H; // 64
export const DIFF_DIMS = { w: DIFF_W, h: DIFF_H };
export { PIXEL_NOISE_THRESHOLD };
