'use client';
import { useEffect, useRef, useState } from 'react';
import { FpsSampler, type FpsSnapshot } from '@/lib/perf/fps-sampler';

export interface UseFpsMonitorOptions {
  /** Disable the RAF loop entirely (e.g. when no player mounted). Default true. */
  enabled?: boolean;
  /** Window in ms. Default 2000. */
  windowMs?: number;
  /** FPS threshold. Default 30. */
  threshold?: number;
  /** State publish interval ms (throttle setState). Default 250. */
  publishMs?: number;
}

export type FpsMonitorState = FpsSnapshot;

/**
 * Self-measured FPS via requestAnimationFrame.
 *
 * Why RAF over Remotion Player's `frameupdate` event:
 *  - `frameupdate` fires per *composition* frame which is desired-rate, not
 *    actual-render-rate. We want the browser's actual paint cadence.
 *  - RAF callbacks line up with the compositor and reflect real jank.
 *
 * Returns the latest snapshot; throttled by `publishMs` so it doesn't churn
 * React on every frame.
 */
export function useFpsMonitor(options: UseFpsMonitorOptions = {}): FpsMonitorState {
  const {
    enabled = true,
    windowMs = 2000,
    threshold = 30,
    publishMs = 250,
  } = options;

  const [state, setState] = useState<FpsMonitorState>({
    fps: null,
    isLow: false,
    sampleCount: 0,
  });

  const samplerRef = useRef<FpsSampler | null>(null);
  if (samplerRef.current === null) {
    samplerRef.current = new FpsSampler({ windowMs, threshold });
  }

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }
    // Re-create sampler so option changes take effect.
    samplerRef.current = new FpsSampler({ windowMs, threshold });

    let rafId = 0;
    let lastPublish = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const sampler = samplerRef.current!;
      sampler.record(now);
      if (now - lastPublish >= publishMs) {
        lastPublish = now;
        const snap = sampler.read(now);
        setState((prev) => {
          // Avoid re-render when nothing meaningful changed.
          if (
            prev.isLow === snap.isLow &&
            prev.sampleCount === snap.sampleCount &&
            // Round fps to int for change-detection.
            Math.round(prev.fps ?? -1) === Math.round(snap.fps ?? -1)
          ) {
            return prev;
          }
          return snap;
        });
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled, windowMs, threshold, publishMs]);

  return state;
}
