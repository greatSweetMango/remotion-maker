import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

const PARAMS = {
  primaryColor: "#22d3ee",        // type: color
  secondaryColor: "#f472b6",      // type: color
  accentColor: "#facc15",         // type: color
  backgroundColor: "#070712",     // type: color
  textColor: "#ffffff",           // type: color
  particleCount: 60,              // type: range, min: 10, max: 160
  gravity: 1.4,                   // type: range, min: 0.0, max: 4.0
  bounce: 0.78,                   // type: range, min: 0.2, max: 0.95
  emitSpeed: 18,                  // type: range, min: 4, max: 40, unit: px
} as const;

export const ParticlePhysics = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  particleCount = PARAMS.particleCount,
  gravity = PARAMS.gravity,
  bounce = PARAMS.bounce,
  emitSpeed = PARAMS.emitSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  void textColor;

  const count = Math.round(particleCount as number);
  const g = (gravity as number) * 0.6; // px / frame^2 scale
  const b = bounce as number;
  const v0 = emitSpeed as number;
  const floor = height - 80;

  // Forward simulation per particle (deterministic, frame-by-frame).
  const particles = Array.from({ length: count }).map((_, i) => {
    const seed = i * 12.9898;
    const rnd = (k: number) => {
      const s = Math.sin(seed + k) * 43758.5453;
      return s - Math.floor(s);
    };
    const startX = rnd(1) * width;
    const startY = rnd(2) * (height * 0.35);
    const angle = (rnd(3) - 0.5) * Math.PI * 0.6 - Math.PI * 0.5;
    const speed = v0 * (0.6 + rnd(4) * 0.8);
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    let x = startX;
    let y = startY;
    const delay = Math.floor(rnd(5) * 30);
    const sim = Math.max(0, frame - delay);

    for (let f = 0; f < sim; f++) {
      vy += g;
      x += vx;
      y += vy;
      if (y >= floor) {
        y = floor;
        vy = -vy * b;
        vx *= 0.92;
      }
      if (x < 0) { x = 0; vx = -vx * b; }
      if (x > width) { x = width; vx = -vx * b; }
    }
    const size = 8 + rnd(6) * 22;
    const colorPick = rnd(7);
    const color =
      colorPick < 0.34 ? primaryColor :
      colorPick < 0.68 ? secondaryColor :
      accentColor;
    return { x, y, size, color: color as string, alpha: 0.55 + rnd(8) * 0.4 };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, overflow: 'hidden' }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 110%, ${primaryColor}33, transparent 55%), radial-gradient(circle at 80% 0%, ${secondaryColor}22, transparent 50%)`,
      }} />
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: p.x - p.size / 2,
          top: p.y - p.size / 2,
          width: p.size,
          height: p.size,
          borderRadius: '50%',
          backgroundColor: p.color,
          opacity: p.alpha,
          filter: 'blur(0.5px)',
          boxShadow: `0 0 ${p.size * 1.6}px ${p.color}`,
        }} />
      ))}
      {/* ground glow */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: floor,
        height: 4,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        opacity: 0.4,
      }} />
    </AbsoluteFill>
  );
};
