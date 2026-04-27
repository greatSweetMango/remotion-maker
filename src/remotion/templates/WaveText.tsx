import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

const PARAMS = {
  text: "Ride the wave",          // type: text
  primaryColor: "#22d3ee",        // type: color
  accentColor: "#a78bfa",         // type: color
  backgroundColor: "#0a0a14",     // type: color
  fontSize: 140,                  // type: range, min: 50, max: 240
  amplitude: 40,                  // type: range, min: 5, max: 120
  waveSpeed: 1.0,                 // type: range, min: 0.2, max: 4.0
} as const;

export const WaveText = ({
  text = PARAMS.text,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  amplitude = PARAMS.amplitude,
  waveSpeed = PARAMS.waveSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * (waveSpeed as number);

  const chars = String(text).split('');

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', fontSize: fontSize as number, fontWeight: 800, letterSpacing: '0.02em' }}>
        {chars.map((ch, i) => {
          const phase = t * Math.PI * 2 + i * 0.4;
          const dy = Math.sin(phase) * (amplitude as number);
          const mix = (Math.sin(phase) + 1) / 2;
          const r1 = parseInt(String(primaryColor).slice(1, 3), 16);
          const g1 = parseInt(String(primaryColor).slice(3, 5), 16);
          const b1 = parseInt(String(primaryColor).slice(5, 7), 16);
          const r2 = parseInt(String(accentColor).slice(1, 3), 16);
          const g2 = parseInt(String(accentColor).slice(3, 5), 16);
          const b2 = parseInt(String(accentColor).slice(5, 7), 16);
          const r = Math.round(r1 * (1 - mix) + r2 * mix);
          const g = Math.round(g1 * (1 - mix) + g2 * mix);
          const b = Math.round(b1 * (1 - mix) + b2 * mix);
          return (
            <span key={i} style={{
              display: 'inline-block',
              transform: `translateY(${dy}px)`,
              color: `rgb(${r},${g},${b})`,
              whiteSpace: 'pre',
            }}>{ch}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
