'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import { Badge } from '@/components/ui/badge';
import { Play, Grid3x3 } from 'lucide-react';
import type { GeneratedAsset } from '@/types';
import { useActiveSequenceOptional } from '@/hooks/useActiveSequence';

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

export function PlayerPanel({ asset, paramValues, isGenerating }: PlayerPanelProps) {
  const [bg, setBg] = useState('#0f0f0f');
  const playerRef = useRef<PlayerRef>(null);
  const sequenceCtx = useActiveSequenceOptional();

  // Register the player ref with the active-sequence context (if any) once it mounts.
  useEffect(() => {
    if (!sequenceCtx) return;
    sequenceCtx.registerPlayerRef(playerRef.current);
    return () => sequenceCtx.registerPlayerRef(null);
  }, [sequenceCtx, asset?.id]);

  const Component = useMemo(() => {
    if (!asset?.jsCode) return null;
    return evaluateComponent(asset.jsCode);
  }, [asset?.jsCode]);

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
        {asset && (
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
            {asset.fps}fps · {(asset.durationInFrames / asset.fps).toFixed(1)}s
          </Badge>
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
        ) : Component && asset ? (
          <div className="w-full h-full flex items-center justify-center">
            <div style={{ width: '100%', maxWidth: '100%', aspectRatio: `${asset.width}/${asset.height}` }}>
              <Player
                ref={playerRef}
                component={Component as React.ComponentType<Record<string, unknown>>}
                inputProps={paramValues}
                durationInFrames={asset.durationInFrames}
                fps={asset.fps}
                compositionWidth={asset.width}
                compositionHeight={asset.height}
                style={{ width: '100%', height: '100%' }}
                autoPlay
                loop
                controls
                clickToPlay
              />
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
