/**
 * FPS sampler — pure logic, framework-agnostic, easy to unit-test.
 *
 * Records frame timestamps in a sliding window and reports the measured fps
 * over that window. A "low fps" decision is made only when the window is full
 * AND the measured fps stays below the threshold for the whole window — this
 * avoids reacting to brief stutters (e.g. tab switch, GC pause).
 *
 * Used by the Player FPS monitor (TM-25) to drive auto-downsampling.
 */

export interface FpsSamplerOptions {
  /** Window length in milliseconds. Default 2000 (2s). */
  windowMs?: number;
  /** FPS threshold. Below this, isLow becomes true once the window is full. Default 30. */
  threshold?: number;
  /** Hard cap on stored timestamps to bound memory. Default 240. */
  maxSamples?: number;
}

export interface FpsSnapshot {
  /** Measured fps over the current window, or null if not enough samples yet. */
  fps: number | null;
  /** True iff window is full and measured fps < threshold. */
  isLow: boolean;
  /** Number of timestamps currently in the window. */
  sampleCount: number;
}

export class FpsSampler {
  private timestamps: number[] = [];
  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly maxSamples: number;

  constructor(opts: FpsSamplerOptions = {}) {
    this.windowMs = opts.windowMs ?? 2000;
    this.threshold = opts.threshold ?? 30;
    this.maxSamples = opts.maxSamples ?? 240;
  }

  /** Record a frame at the given timestamp (ms). */
  record(now: number): void {
    this.timestamps.push(now);
    // Drop anything older than the window.
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
    // Bound memory.
    if (this.timestamps.length > this.maxSamples) {
      this.timestamps.splice(0, this.timestamps.length - this.maxSamples);
    }
  }

  /** Read the current snapshot. */
  read(now: number): FpsSnapshot {
    // Trim by `now` so a snapshot taken after a long gap reflects reality.
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
    const count = this.timestamps.length;
    if (count < 2) {
      return { fps: null, isLow: false, sampleCount: count };
    }
    const span = this.timestamps[count - 1] - this.timestamps[0];
    if (span <= 0) {
      return { fps: null, isLow: false, sampleCount: count };
    }
    // (count - 1) intervals over `span` ms.
    const fps = ((count - 1) * 1000) / span;
    // Only flag low when window is effectively full (span covers >=80% of window).
    const windowFull = span >= this.windowMs * 0.8;
    const isLow = windowFull && fps < this.threshold;
    return { fps, isLow, sampleCount: count };
  }

  reset(): void {
    this.timestamps = [];
  }
}

/**
 * Choose a downsampled (fps, width, height) given measured low fps.
 *
 * Strategy:
 *  - If composition fps > 30, drop to 30.
 *  - If width > 720 (i.e. 1080p+), scale longest side to 720 preserving aspect.
 *  - Both reductions can apply; if neither applies, return the original.
 *
 * Returns null when no downsampling is possible (already at floor).
 */
export interface AssetDims {
  fps: number;
  width: number;
  height: number;
}

export function pickDownsample(asset: AssetDims): AssetDims | null {
  let { fps, width, height } = asset;
  let changed = false;
  if (fps > 30) {
    fps = 30;
    changed = true;
  }
  // "720p" convention: shorter side = 720. e.g. 1920x1080 -> 1280x720.
  const shortest = Math.min(width, height);
  if (shortest > 720) {
    const scale = 720 / shortest;
    // Keep dimensions even — Remotion compositions render fine on odd numbers
    // but rounding is cleaner for downstream tooling.
    width = Math.max(2, Math.round((width * scale) / 2) * 2);
    height = Math.max(2, Math.round((height * scale) / 2) * 2);
    changed = true;
  }
  return changed ? { fps, width, height } : null;
}
