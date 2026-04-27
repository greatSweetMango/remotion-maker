'use client';
import React from 'react';
import { Player } from '@remotion/player';
import { FluidBlobs } from '@/remotion/templates/FluidBlobs';

export function Client() {
  return (
    <div style={{ background: '#000', minHeight: '100vh', padding: 24, color: '#fff' }}>
      <h1 style={{ fontSize: 16, marginBottom: 12 }}>TM-61 FluidBlobs preview</h1>
      <div data-testid="frame-zero" style={{ width: 960, height: 540, marginBottom: 24, border: '1px solid #333' }}>
        <Player
          component={FluidBlobs as React.ComponentType<Record<string, unknown>>}
          inputProps={{}}
          durationInFrames={480}
          fps={60}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{ width: '100%', height: '100%' }}
          autoPlay={false}
          controls
        />
      </div>
      <div data-testid="frame-mid" style={{ width: 960, height: 540, border: '1px solid #333' }}>
        <Player
          component={FluidBlobs as React.ComponentType<Record<string, unknown>>}
          inputProps={{}}
          durationInFrames={480}
          fps={60}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{ width: '100%', height: '100%' }}
          autoPlay
          loop
        />
      </div>
    </div>
  );
}
