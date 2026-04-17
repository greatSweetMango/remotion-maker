import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  targetNumber: 1000,           // type: range, min: 1, max: 100000
  prefix: "$",                  // type: text
  suffix: "K",                  // type: text
  primaryColor: "#7C3AED",      // type: color
  backgroundColor: "#0f0f17",   // type: color
  fontSize: 120,                // type: range, min: 40, max: 240, unit: px
  speed: 1.0,                   // type: range, min: 0.3, max: 3.0
  showDecimal: false,           // type: boolean
} as const;

export const CounterAnimation = ({
  targetNumber = PARAMS.targetNumber,
  prefix = PARAMS.prefix,
  suffix = PARAMS.suffix,
  primaryColor = PARAMS.primaryColor,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  speed = PARAMS.speed,
  showDecimal = PARAMS.showDecimal,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const progress = spring({
    fps,
    frame: frame * speed,
    config: { damping: 200, stiffness: 80, mass: 1 },
    durationInFrames: durationInFrames * 0.8,
  });

  const currentValue = progress * (targetNumber as number);
  const displayValue = showDecimal
    ? currentValue.toFixed(1)
    : Math.round(currentValue).toLocaleString();

  const scale = interpolate(frame, [0, 10], [0.8, 1], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `scale(${scale})`, opacity, textAlign: 'center' }}>
        <div style={{
          fontSize: fontSize as number,
          fontWeight: 900,
          color: primaryColor as string,
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>
          {prefix}{displayValue}{suffix}
        </div>
        <div style={{
          height: 4,
          backgroundColor: primaryColor as string,
          borderRadius: 2,
          width: `${progress * 100}%`,
          marginTop: 16,
          transition: 'width 0.1s',
        }} />
      </div>
    </AbsoluteFill>
  );
};
