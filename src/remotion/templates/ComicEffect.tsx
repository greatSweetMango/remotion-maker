import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  text: "POW!",               // type: text
  primaryColor: "#FFE11A",    // type: color
  strokeColor: "#1A0066",     // type: color
  backgroundColor: "#FF3366", // type: color
  size: 1.0,                  // type: range, min: 0.3, max: 2.0
  rotation: -8,               // type: range, min: -30, max: 30
} as const;

export const ComicEffect = ({
  text = PARAMS.text,
  primaryColor = PARAMS.primaryColor,
  strokeColor = PARAMS.strokeColor,
  backgroundColor = PARAMS.backgroundColor,
  size = PARAMS.size,
  rotation = PARAMS.rotation,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ fps, frame, config: { damping: 8, stiffness: 300, mass: 0.5 } });
  const burstScale = spring({ fps, frame: frame - 3, config: { damping: 15, stiffness: 200 } });

  const wobble = Math.sin(frame * 0.4) * 2;

  const numRays = 20;
  const rays = Array.from({ length: numRays }, (_, i) => {
    const angle = (i / numRays) * 360;
    const length = 380 + Math.sin(i * 1.7) * 60;
    return { angle, length };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${burstScale * (size as number)})`,
      }}>
        <svg viewBox="-500 -500 1000 1000" style={{ position: 'absolute', width: '100%', height: '100%' }}>
          {rays.map((ray, i) => {
            const rad = (ray.angle * Math.PI) / 180;
            const x2 = Math.cos(rad) * ray.length;
            const y2 = Math.sin(rad) * ray.length;
            return (
              <line
                key={i}
                x1={0} y1={0} x2={x2} y2={y2}
                stroke={primaryColor as string}
                strokeWidth={i % 2 === 0 ? 28 : 14}
                opacity={0.6 + (i % 3) * 0.1}
              />
            );
          })}
        </svg>
      </div>

      <div style={{
        transform: `scale(${scale * (size as number)}) rotate(${(rotation as number) + wobble}deg)`,
        fontSize: 140,
        fontWeight: 900,
        fontFamily: 'Impact, "Arial Black", sans-serif',
        color: primaryColor as string,
        WebkitTextStroke: `6px ${strokeColor}`,
        textShadow: `6px 6px 0 ${strokeColor}, -2px -2px 0 ${strokeColor}`,
        letterSpacing: '-0.02em',
        userSelect: 'none',
        zIndex: 1,
        position: 'relative',
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};
