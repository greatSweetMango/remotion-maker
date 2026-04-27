'use client';
import React, { useMemo } from 'react';
import { Player } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import type { Parameter } from '@/types';

interface SharePlayerProps {
  jsCode: string;
  parameters: Parameter[];
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  watermark: boolean;
}

/**
 * Read-only Player for the public /share/[slug] route.
 * - Plays asset on loop with controls disabled (no scrubbing of length, no edit).
 * - Renders a "Made with EasyMake" watermark when `watermark` is true (FREE tier).
 */
export function SharePlayer({
  jsCode,
  parameters,
  durationInFrames,
  fps,
  width,
  height,
  watermark,
}: SharePlayerProps) {
  const Component = useMemo(() => evaluateComponent(jsCode), [jsCode]);

  const inputProps = useMemo<Record<string, unknown>>(() => {
    const props: Record<string, unknown> = {};
    for (const p of parameters) props[p.key] = p.value;
    return props;
  }, [parameters]);

  if (!Component) {
    return (
      <div className="flex items-center justify-center w-full h-full text-slate-400 text-sm">
        Unable to render this animation.
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ aspectRatio: `${width}/${height}` }}>
      <Player
        component={Component as React.ComponentType<Record<string, unknown>>}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{ width: '100%', height: '100%' }}
        autoPlay
        loop
        controls={false}
        clickToPlay={false}
      />
      {watermark && (
        <div
          className="pointer-events-none absolute bottom-3 right-3 px-2.5 py-1 rounded-md bg-black/55 backdrop-blur-sm text-white text-xs font-medium tracking-wide"
          data-testid="share-watermark"
        >
          Made with EasyMake
        </div>
      )}
    </div>
  );
}
