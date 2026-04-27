import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  brand: "EASYMAKE",                  // type: text
  tagline: "Make it move.",           // type: text
  primaryColor: "#7C3AED",            // type: color
  accentColor: "#22d3ee",             // type: color
  backgroundColor: "#0a0a14",         // type: color
  textColor: "#ffffff",               // type: color
} as const;

export const LogoReveal = ({
  brand = PARAMS.brand,
  tagline = PARAMS.tagline,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ring = spring({ fps, frame, config: { damping: 16, stiffness: 90 } });
  const wipe = interpolate(frame, [12, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const brandFade = interpolate(frame, [24, 48], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const taglineFade = interpolate(frame, [42, 66], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
    }}>
      <svg width="360" height="360" viewBox="0 0 360 360" style={{ marginBottom: 36 }}>
        <defs>
          <linearGradient id="lr-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={primaryColor as string} />
            <stop offset="100%" stopColor={accentColor as string} />
          </linearGradient>
        </defs>
        <circle cx="180" cy="180" r={140 * ring}
          fill="none" stroke="url(#lr-grad)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 140 * wipe} ${2 * Math.PI * 140}`}
          transform="rotate(-90 180 180)" />
        <circle cx="180" cy="180" r={70 * ring} fill="url(#lr-grad)" opacity={0.85} />
      </svg>
      <div style={{
        color: textColor as string, fontSize: 100, fontWeight: 900,
        letterSpacing: '0.12em', opacity: brandFade,
        transform: `translateY(${(1 - brandFade) * 16}px)`,
      }}>{brand}</div>
      <div style={{
        color: textColor as string, fontSize: 32, fontWeight: 400,
        opacity: 0.7 * taglineFade, marginTop: 14, letterSpacing: '0.05em',
      }}>{tagline}</div>
    </AbsoluteFill>
  );
};
