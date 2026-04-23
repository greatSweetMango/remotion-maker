import { useCurrentFrame, AbsoluteFill } from 'remotion';

const PARAMS = {
  color1: "#7C3AED",           // type: color
  color2: "#EC4899",           // type: color
  color3: "#3B82F6",           // type: color
  backgroundColor: "#030307",  // type: color
  speed: 1.0,                  // type: range, min: 0.2, max: 3.0
  blur: 100,                   // type: range, min: 20, max: 200, unit: px
} as const;

export const GradientOrbs = ({
  color1 = PARAMS.color1,
  color2 = PARAMS.color2,
  color3 = PARAMS.color3,
  backgroundColor = PARAMS.backgroundColor,
  speed = PARAMS.speed,
  blur = PARAMS.blur,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const t = frame * 0.008 * (speed as number);

  const orbs = [
    { color: color1 as string, x: 28 + Math.sin(t * 0.8) * 22, y: 38 + Math.cos(t * 0.6) * 20, size: 640 },
    { color: color2 as string, x: 62 + Math.cos(t * 0.55) * 24, y: 58 + Math.sin(t * 0.9) * 22, size: 560 },
    { color: color3 as string, x: 48 + Math.sin(t * 1.1) * 18, y: 28 + Math.cos(t * 0.75) * 26, size: 580 },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, overflow: 'hidden' }}>
      {orbs.map((orb, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${orb.x}%`,
          top: `${orb.y}%`,
          width: orb.size,
          height: orb.size,
          borderRadius: '50%',
          backgroundColor: orb.color,
          filter: `blur(${blur}px)`,
          transform: 'translate(-50%, -50%)',
          opacity: 0.65,
          mixBlendMode: 'screen',
        }} />
      ))}
    </AbsoluteFill>
  );
};
