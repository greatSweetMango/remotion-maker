import { useCurrentFrame, useVideoConfig, AbsoluteFill, interpolate } from 'remotion';

// Floating "holographic" card: perspective-rotated rect with iridescent
// conic-gradient sheen, secondary diagonal sheen sweep, and soft drop shadow.
// Pure CSS gradients + transforms — no shaders, no images.
const PARAMS = {
  primaryColor: "#7C3AED",        // type: color
  secondaryColor: "#22d3ee",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#06061a",     // type: color
  textColor: "#ffffff",           // type: color
  title: "HOLOGRAM",              // type: text
  subtitle: "edition / 001",      // type: text
  rotateRange: 22,                // type: range, min: 0, max: 60, unit: deg
  shimmerSpeed: 1.0,              // type: range, min: 0.2, max: 3.0
} as const;

export const HolographicCard = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  title = PARAMS.title,
  subtitle = PARAMS.subtitle,
  rotateRange = PARAMS.rotateRange,
  shimmerSpeed = PARAMS.shimmerSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const t = (frame / fps) * (shimmerSpeed as number);
  const total = durationInFrames > 0 ? durationInFrames : fps * 6;

  // Card pose: slow oscillating tilt around X and Y axes.
  const rotY = Math.sin(t * 0.9) * (rotateRange as number);
  const rotX = Math.cos(t * 0.7) * (rotateRange as number) * 0.45;

  // Entrance: scale + fade in.
  const enterScale = interpolate(frame, [0, Math.min(30, total / 6)], [0.6, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });
  const enterOpacity = interpolate(frame, [0, Math.min(20, total / 8)], [0, 1], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  // Conic gradient angle moves with time → iridescent rotation.
  const conicAngle = (t * 80) % 360;

  // Diagonal sheen position (0..1 across the card).
  const sheenPos = ((t * 0.5) % 1) * 100;

  // Card dimensions in CSS pixels.
  const cardW = 720;
  const cardH = 460;

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      perspective: '1400px',
    }}>
      {/* Ambient glow behind card */}
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 55%, ${primaryColor}33, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      <div style={{
        width: cardW,
        height: cardH,
        position: 'relative',
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${enterScale})`,
        opacity: enterOpacity,
        borderRadius: 28,
        boxShadow: `0 40px 80px ${backgroundColor}cc, 0 0 80px ${primaryColor}55`,
      }}>
        {/* Base layer: conic iridescent */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 28,
          background: `conic-gradient(from ${conicAngle}deg at 50% 50%,
            ${primaryColor},
            ${secondaryColor},
            ${accentColor},
            ${primaryColor})`,
          filter: 'saturate(1.2) brightness(1.05)',
        }} />

        {/* Soft inner gradient for depth */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 28,
          background: `linear-gradient(135deg, ${backgroundColor}66, transparent 35%, ${backgroundColor}88 100%)`,
        }} />

        {/* Diagonal sheen sweep */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 28,
          background: `linear-gradient(115deg,
            transparent ${Math.max(0, sheenPos - 18)}%,
            #ffffff66 ${sheenPos}%,
            transparent ${Math.min(100, sheenPos + 18)}%)`,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }} />

        {/* Border glow */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 28,
          border: `1.5px solid ${accentColor}aa`,
          boxShadow: `inset 0 0 40px ${primaryColor}55`,
          pointerEvents: 'none',
        }} />

        {/* Text content */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: 48,
          color: textColor as string,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}>
          <div style={{
            fontSize: 24,
            letterSpacing: '0.4em',
            opacity: 0.85,
            fontWeight: 600,
          }}>{subtitle}</div>

          <div style={{
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: '0.04em',
            lineHeight: 1,
            textShadow: `0 4px 24px ${backgroundColor}aa`,
          }}>{title}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
