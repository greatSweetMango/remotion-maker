import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  badgeText: "PRO",                       // type: text
  title: "Premium Plan",                  // type: text
  subtitle: "Unlimited everything",       // type: text
  primaryColor: "#7C3AED",                // type: color
  accentColor: "#22d3ee",                 // type: color
  backgroundColor: "#0a0a14",             // type: color
  textColor: "#ffffff",                   // type: color
} as const;

export const IconBadge = ({
  badgeText = PARAMS.badgeText,
  title = PARAMS.title,
  subtitle = PARAMS.subtitle,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const badgeScale = spring({ fps, frame, config: { damping: 10, stiffness: 200 } });
  const badgeRot = interpolate(frame, [0, 30], [-180, 0], { extrapolateRight: 'clamp' });
  const ringPulse = 1 + 0.06 * Math.sin((frame / fps) * Math.PI * 2);
  const titleFade = interpolate(frame, [18, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const subFade = interpolate(frame, [28, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        position: 'relative',
        width: 320, height: 320, marginBottom: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: `scale(${badgeScale}) rotate(${badgeRot}deg)`,
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%',
          background: `conic-gradient(from 0deg, ${primaryColor}, ${accentColor}, ${primaryColor})`,
          transform: `scale(${ringPulse})`,
          filter: 'blur(2px)',
        }} />
        <div style={{
          position: 'absolute', inset: 16,
          borderRadius: '50%',
          backgroundColor: backgroundColor as string,
          border: `4px solid ${accentColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            fontSize: 84, fontWeight: 900,
            background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            color: 'transparent', letterSpacing: '0.04em',
          }}>{badgeText}</div>
        </div>
      </div>
      <div style={{
        color: textColor as string, fontSize: 64, fontWeight: 800,
        opacity: titleFade, transform: `translateY(${(1 - titleFade) * 16}px)`,
        letterSpacing: '-0.02em',
      }}>{title}</div>
      <div style={{
        color: textColor as string, fontSize: 28, fontWeight: 400,
        opacity: 0.7 * subFade, marginTop: 8,
      }}>{subtitle}</div>
    </AbsoluteFill>
  );
};
