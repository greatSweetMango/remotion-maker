import { useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill } from 'remotion';

const PARAMS = {
  text: "NEON DREAMS",                  // type: text
  primaryColor: "#22d3ee",              // type: color
  accentColor: "#f472b6",               // type: color
  backgroundColor: "#0a0a14",           // type: color
  fontSize: 180,                        // type: range, min: 60, max: 320
  pulseSpeed: 1.0,                      // type: range, min: 0.2, max: 4.0
} as const;

export const GlowingText = ({
  text = PARAMS.text,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  pulseSpeed = PARAMS.pulseSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const t = (frame / fps) * (pulseSpeed as number);
  const pulse = 0.6 + 0.4 * Math.sin(t * Math.PI * 2);
  const glow = 30 + 50 * pulse;
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        fontSize: fontSize as number,
        fontWeight: 900,
        letterSpacing: '0.04em',
        color: '#ffffff',
        textShadow: `
          0 0 ${glow * 0.3}px ${primaryColor},
          0 0 ${glow * 0.6}px ${primaryColor},
          0 0 ${glow}px ${primaryColor},
          0 0 ${glow * 1.5}px ${accentColor},
          0 0 ${glow * 2}px ${accentColor}
        `,
        opacity,
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};
