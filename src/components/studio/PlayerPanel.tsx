'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { evaluateComponentDetailed } from '@/lib/remotion/evaluator';
import { EvaluatorErrorBoundary } from './EvaluatorErrorBoundary';
import { Badge } from '@/components/ui/badge';
import { Play, Grid3x3, Gauge } from 'lucide-react';
import type { GeneratedAsset } from '@/types';
import { useActiveSequenceOptional } from '@/hooks/useActiveSequence';
import { useFpsMonitor } from '@/hooks/useFpsMonitor';
import { pickDownsample } from '@/lib/perf/fps-sampler';

interface PlayerPanelProps {
  asset: GeneratedAsset | null;
  paramValues: Record<string, unknown>;
  isGenerating: boolean;
}

const BACKGROUNDS = [
  { label: 'Dark', value: '#0f0f0f' },
  { label: 'Light', value: '#ffffff' },
  { label: 'Transparent', value: 'transparent' },
  { label: 'Checker', value: 'checker' },
];

const IS_DEV = process.env.NODE_ENV !== 'production';

export function PlayerPanel({ asset, paramValues, isGenerating }: PlayerPanelProps) {
  const [bg, setBg] = useState('#0f0f0f');
  const playerRef = useRef<PlayerRef>(null);
  const sequenceCtx = useActiveSequenceOptional();

  // TM-46 r2: detect the `?frame=` query so we suppress autoPlay when set.
  // Mount-only — capture flow expects deterministic frame, not playback.
  const seekFrame = typeof window !== 'undefined'
    ? (() => {
        const v = new URLSearchParams(window.location.search).get('frame');
        if (v === null) return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })()
    : null;

  // Auto-downsample is on by default; user can force original via toggle.
  const [autoDownsample, setAutoDownsample] = useState(true);

  // Once we've decided to downsample, we *stick* with it for this asset so
  // the act of downsampling (which restores fps) doesn't immediately undo
  // the decision, causing oscillation. Stored as `[assetId, latched]` so we
  // can reset during render when the asset changes (avoids setState-in-effect).
  const [latchState, setLatchState] = useState<{ assetId: string | null; latched: boolean }>({
    assetId: null,
    latched: false,
  });
  const downsampleLatched = latchState.assetId === (asset?.id ?? null) && latchState.latched;
  if (asset && latchState.assetId !== asset.id) {
    // Render-phase reset is safe: we only update state during render when the
    // current value disagrees with derived input, matching React's "store info
    // from previous render" pattern.
    setLatchState({ assetId: asset.id, latched: false });
  }

  // Register the player ref with the active-sequence context (if any) once it mounts.
  useEffect(() => {
    if (!sequenceCtx) return;
    sequenceCtx.registerPlayerRef(playerRef.current);
    return () => sequenceCtx.registerPlayerRef(null);
  }, [sequenceCtx, asset?.id]);

  const evalResult = useMemo(() => {
    if (!asset?.jsCode) return { component: null, error: null };
    return evaluateComponentDetailed(asset.jsCode);
  }, [asset?.jsCode]);
  const Component = evalResult.component;
  const evaluatorError = evalResult.error;

  // Only run the FPS monitor when there's something playing.
  const fpsState = useFpsMonitor({ enabled: Boolean(Component && asset && !isGenerating) });

  // TM-46 r2: support `?frame=N` query for visual judge capture.
  // When present (and Player has loaded), pause and seek to that frame so
  // automated screenshots reflect a deterministic timeline position. Stable
  // across asset.id changes — re-applies whenever the asset reloads.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!asset || !Component) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('frame');
    if (raw === null) return;
    const target = parseInt(raw, 10);
    if (!Number.isFinite(target) || target < 0) return;
    // The Player needs a tick before seekTo is reliable on first mount.
    const t = setTimeout(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.pause();
        const dur = asset.durationInFrames ?? 0;
        const clamped = Math.max(0, Math.min(target, Math.max(0, dur - 1)));
        p.seekTo(clamped);
      } catch {
        // Ignore — Player not ready or unmounted.
      }
    }, 350);
    return () => clearTimeout(t);
  }, [asset, Component]);

  // Compute the effective composition dims. Decision flow:
  //   1. user disabled auto → original dims always.
  //   2. already latched → use downsampled dims.
  //   3. monitor says isLow → latch and downsample (if possible).
  const effectiveAsset = useMemo(() => {
    if (!asset) return null;
    if (!autoDownsample) {
      return { fps: asset.fps, width: asset.width, height: asset.height };
    }
    if (downsampleLatched) {
      const ds = pickDownsample(asset);
      return ds ?? { fps: asset.fps, width: asset.width, height: asset.height };
    }
    return { fps: asset.fps, width: asset.width, height: asset.height };
  }, [asset, autoDownsample, downsampleLatched]);

  // Latch when monitor reports low fps and we *can* downsample.
  // setState-in-effect is intentional here: the FPS monitor is an external
  // signal source (RAF measurements) and we are translating its state into
  // React state. Conditions short-circuit so this fires at most once per
  // asset, guarding against cascading renders.
  useEffect(() => {
    if (!autoDownsample) return;
    if (downsampleLatched) return;
    if (!asset) return;
    if (!fpsState.isLow) return;
    if (pickDownsample(asset) === null) return; // already at floor
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLatchState({ assetId: asset.id, latched: true });
  }, [autoDownsample, downsampleLatched, asset, fpsState.isLow]);

  const isDownsampling = autoDownsample && downsampleLatched && asset
    ? pickDownsample(asset) !== null
    : false;

  const backgroundStyle: React.CSSProperties = bg === 'checker'
    ? {
        backgroundImage:
          'linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      }
    : { backgroundColor: bg };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700">
        <span className="text-xs text-slate-400 font-medium flex-1 truncate">
          {asset?.title || 'Preview'}
        </span>
        {asset && effectiveAsset && (
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
            {effectiveAsset.fps}fps · {(asset.durationInFrames / asset.fps).toFixed(1)}s
            {isDownsampling && (
              <span className="ml-1 text-amber-400" title="Auto-downsampled for smoother playback">
                · ds
              </span>
            )}
          </Badge>
        )}
        {IS_DEV && fpsState.fps !== null && (
          <Badge
            variant="outline"
            className={`text-xs border-slate-600 ${fpsState.isLow ? 'text-amber-400' : 'text-emerald-400'}`}
            title={`Measured render fps (sample n=${fpsState.sampleCount})`}
            data-testid="fps-monitor-badge"
          >
            <Gauge className="h-3 w-3 mr-1" />
            {Math.round(fpsState.fps)}
          </Badge>
        )}
        {asset && (
          <button
            type="button"
            onClick={() => {
              setAutoDownsample((v) => !v);
              // Flipping the toggle resets the latched decision so the next
              // measurement window can re-evaluate.
              setLatchState({ assetId: asset?.id ?? null, latched: false });
            }}
            className={`text-xs px-2 py-0.5 rounded border ${
              autoDownsample
                ? 'border-violet-500 text-violet-300'
                : 'border-slate-600 text-slate-400'
            }`}
            title={
              autoDownsample
                ? 'Auto-downsample enabled — click to force original quality'
                : 'Forcing original quality — click to enable auto-downsample'
            }
            data-testid="fps-downsample-toggle"
          >
            {autoDownsample ? 'Auto' : 'Original'}
          </button>
        )}
        <div className="flex gap-1 ml-2">
          {BACKGROUNDS.map(b => (
            <button
              key={b.value}
              title={b.label}
              onClick={() => setBg(b.value)}
              className={`w-5 h-5 rounded border text-xs ${bg === b.value ? 'border-violet-400' : 'border-slate-600'}`}
              style={b.value === 'checker'
                ? { backgroundImage: 'linear-gradient(45deg, #888 25%, transparent 25%)', backgroundSize: '8px 8px' }
                : { backgroundColor: b.value === 'transparent' ? '#666' : b.value }
              }
            >
              {b.value === 'checker' && <Grid3x3 className="h-3 w-3 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden" style={backgroundStyle}>
        {isGenerating ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Generating animation...</span>
          </div>
        ) : Component && asset && effectiveAsset ? (
          <div className="w-full h-full flex items-center justify-center">
            <div style={{ width: '100%', maxWidth: '100%', aspectRatio: `${asset.width}/${asset.height}` }}>
              <EvaluatorErrorBoundary resetKey={asset.id}>
                <Player
                  ref={playerRef}
                  component={Component as React.ComponentType<Record<string, unknown>>}
                  inputProps={paramValues}
                  durationInFrames={Math.max(
                    1,
                    Math.round((asset.durationInFrames / asset.fps) * effectiveAsset.fps),
                  )}
                  fps={effectiveAsset.fps}
                  compositionWidth={effectiveAsset.width}
                  compositionHeight={effectiveAsset.height}
                  style={{ width: '100%', height: '100%' }}
                  autoPlay={seekFrame === null}
                  loop={seekFrame === null}
                  controls
                  clickToPlay={seekFrame === null}
                />
              </EvaluatorErrorBoundary>
            </div>
          </div>
        ) : evaluatorError && asset ? (
          <div
            data-testid="evaluator-error-panel"
            className="flex flex-col items-center gap-3 text-center max-w-sm"
          >
            <div className="w-16 h-16 rounded-full bg-amber-900/30 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <div>
              <p className="text-slate-200 font-medium">{evaluatorError.userMessage}</p>
              {evaluatorError.hint && (
                <p className="text-slate-500 text-sm mt-1">{evaluatorError.hint}</p>
              )}
              <p className="text-slate-600 text-xs mt-2" data-testid="evaluator-error-kind">
                ({evaluatorError.kind})
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-violet-900/30 flex items-center justify-center">
              <Play className="h-8 w-8 text-violet-400" />
            </div>
            <div>
              <p className="text-slate-300 font-medium">No animation yet</p>
              <p className="text-slate-500 text-sm mt-1">Enter a prompt and click Generate to create your animation</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
