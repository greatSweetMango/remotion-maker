import { useCurrentFrame, interpolate, AbsoluteFill } from 'remotion';

const PARAMS = {
  color: "#7C3AED",            // type: color
  backgroundColor: "#0a0a12", // type: color
  label: "LIVE",               // type: text
  labelColor: "#ffffff",       // type: color
  pulseCount: 4,               // type: range, min: 2, max: 6
  speed: 1.0,                  // type: range, min: 0.3, max: 2.5
} as const;

export const CirclePulse = ({
  color = PARAMS.color,
  backgroundColor = PARAMS.backgroundColor,
  label = PARAMS.label,
  labelColor = PARAMS.labelColor,
  pulseCount = PARAMS.pulseCount,
  speed = PARAMS.speed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const cycle = 60;
  const count = Math.round(pulseCount as number);

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {Array.from({ length: count }, (_, i) => {
        const offset = (i / count) * cycle;
        const t = (((frame * (speed as number)) - offset) % cycle + cycle) % cycle;
        const progress = t / cycle;
        const scale = interpolate(progress, [0, 1], [0.1, 3.0]);
        const opacity = interpolate(progress, [0, 0.3, 1], [0.9, 0.5, 0]);
        return (
          <div key={i} style={{
            position: 'absolute',
            width: 140,
            height: 140,
            borderRadius: '50%',
            border: `3px solid ${color as string}`,
            transform: `scale(${scale})`,
            opacity,
          }} />
        );
      })}
      <div style={{
        position: 'relative',
        zIndex: 1,
        width: 100,
        height: 100,
        borderRadius: '50%',
        backgroundColor: color as string,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 0 40px ${color as string}66`,
      }}>
        <span style={{
          color: labelColor as string,
          fontSize: 20,
          fontWeight: 900,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '0.08em',
        }}>
          {label}
        </span>
      </div>
    </AbsoluteFill>
  );
};
