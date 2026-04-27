import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

// Three stacked sine-wave fills with gradient blends — a "liquid surface"
// background loop. Pure SVG paths, no shaders.
const PARAMS = {
  primaryColor: "#7C3AED",        // type: color
  secondaryColor: "#22d3ee",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#06061a",     // type: color
  textColor: "#ffffff",           // type: color
  amplitude: 80,                  // type: range, min: 10, max: 240, unit: px
  frequency: 1.4,                 // type: range, min: 0.4, max: 4.0
  flowSpeed: 1.0,                 // type: range, min: 0.2, max: 3.0
  layerCount: 3,                  // type: range, min: 1, max: 5
} as const;

export const LiquidWave = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  amplitude = PARAMS.amplitude,
  frequency = PARAMS.frequency,
  flowSpeed = PARAMS.flowSpeed,
  layerCount = PARAMS.layerCount,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  void textColor;

  const t = (frame / fps) * (flowSpeed as number);
  const layers = Math.max(1, Math.round(layerCount as number));
  const palette = [primaryColor as string, secondaryColor as string, accentColor as string];

  const buildWavePath = (yBase: number, amp: number, freq: number, phase: number, samples = 80) => {
    let d = `M 0 ${height} L 0 ${yBase.toFixed(2)} `;
    for (let i = 0; i <= samples; i++) {
      const x = (i / samples) * width;
      // Sum of two sines for organic shape.
      const y = yBase
        + Math.sin((x / width) * Math.PI * 2 * freq + phase) * amp
        + Math.sin((x / width) * Math.PI * 2 * freq * 2.3 + phase * 1.7) * amp * 0.35;
      d += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    d += `L ${width} ${height} Z`;
    return d;
  };

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
    }}>
      {/* Soft top glow */}
      <AbsoluteFill style={{
        background: `linear-gradient(180deg, ${primaryColor}22, transparent 50%)`,
      }} />

      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          {Array.from({ length: layers }).map((_, i) => {
            const c1 = palette[i % palette.length];
            const c2 = palette[(i + 1) % palette.length];
            return (
              <linearGradient key={i} id={`lw-grad-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={c1} stopOpacity="0.85" />
                <stop offset="100%" stopColor={c2} stopOpacity="0.5" />
              </linearGradient>
            );
          })}
        </defs>

        {Array.from({ length: layers }).map((_, i) => {
          const layerT = i / Math.max(1, layers - 1 || 1);
          const yBase = height * (0.45 + layerT * 0.35);
          const amp = (amplitude as number) * (1 - i * 0.18);
          const freq = (frequency as number) * (1 + i * 0.25);
          const phase = t * (1.2 + i * 0.4) + i * 1.7;
          const d = buildWavePath(yBase, amp, freq, phase);
          return (
            <path
              key={i}
              d={d}
              fill={`url(#lw-grad-${i})`}
              opacity={0.55 + 0.15 * (1 - i / layers)}
            />
          );
        })}

        {/* Highlight crest — a thin stroke on the top wave */}
        <path
          d={buildWavePath(height * 0.45, amplitude as number, frequency as number, t * 1.2)}
          fill="none"
          stroke={accentColor as string}
          strokeOpacity={0.55}
          strokeWidth={2}
        />
      </svg>
    </AbsoluteFill>
  );
};
