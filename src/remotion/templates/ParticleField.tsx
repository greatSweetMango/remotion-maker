import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

const PARAMS = {
  primaryColor: "#22d3ee",        // type: color
  accentColor: "#a78bfa",         // type: color
  backgroundColor: "#0a0a14",     // type: color
  particleCount: 80,              // type: range, min: 20, max: 200
  driftSpeed: 1.0,                // type: range, min: 0.2, max: 4.0
} as const;

export const ParticleField = ({
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  particleCount = PARAMS.particleCount,
  driftSpeed = PARAMS.driftSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * (driftSpeed as number);

  // Deterministic pseudo-random particle list
  const count = Math.round(particleCount as number);
  const particles = Array.from({ length: count }).map((_, i) => {
    const seed = i * 17.31;
    const baseX = (Math.sin(seed) * 10000) % 1;
    const baseY = (Math.cos(seed * 1.7) * 10000) % 1;
    const sz = 4 + ((Math.sin(seed * 2.3) * 10000) % 1) * 14;
    const speed = 0.3 + ((Math.cos(seed * 3.1) * 10000) % 1) * 0.9;
    const phase = ((Math.sin(seed * 4.7) * 10000) % 1) * Math.PI * 2;
    return { baseX, baseY, sz: Math.abs(sz), speed: Math.abs(speed), phase, seed };
  });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
    }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 30% 40%, ${primaryColor}22, transparent 50%), radial-gradient(circle at 70% 60%, ${accentColor}22, transparent 50%)`,
      }} />
      {particles.map((p, i) => {
        const drift = t * p.speed + p.phase;
        const x = ((p.baseX * 1920) + Math.sin(drift) * 80 + 1920) % 1920;
        const y = ((p.baseY * 1080) + Math.cos(drift * 0.7) * 60 + 1080) % 1080;
        const opacity = 0.3 + 0.5 * Math.abs(Math.sin(drift * 1.3));
        const color = i % 2 === 0 ? primaryColor : accentColor;
        return (
          <div key={i} style={{
            position: 'absolute', left: x, top: y,
            width: p.sz, height: p.sz, borderRadius: '50%',
            backgroundColor: color as string,
            opacity, filter: 'blur(2px)',
            boxShadow: `0 0 ${p.sz * 1.5}px ${color}`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};
