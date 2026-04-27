import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

// Drifting starfield with proximity-linked constellation lines.
// Stars have deterministic positions + velocities (seeded) so renders are stable.
// Lines fade in/out with distance — gives the network/AI/tech vibe.
const PARAMS = {
  primaryColor: "#7C3AED",        // type: color
  secondaryColor: "#22d3ee",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#04040d",     // type: color
  textColor: "#ffffff",           // type: color
  starCount: 70,                  // type: range, min: 20, max: 200
  linkDistance: 220,              // type: range, min: 80, max: 500, unit: px
  starSize: 3,                    // type: range, min: 1, max: 10, unit: px
  flowSpeed: 0.6,                 // type: range, min: 0.0, max: 3.0
} as const;

export const Constellation = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  starCount = PARAMS.starCount,
  linkDistance = PARAMS.linkDistance,
  starSize = PARAMS.starSize,
  flowSpeed = PARAMS.flowSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  void textColor;

  const count = Math.max(2, Math.round(starCount as number));
  const t = (frame / fps) * (flowSpeed as number);
  const linkD = linkDistance as number;
  const linkD2 = linkD * linkD;

  // Seeded stars (deterministic).
  const stars = Array.from({ length: count }).map((_, i) => {
    const seed = i + 1;
    const rnd = (k: number) => {
      const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const baseX = rnd(1) * width;
    const baseY = rnd(2) * height;
    const vx = (rnd(3) - 0.5) * 30;
    const vy = (rnd(4) - 0.5) * 30;
    // Wrap-around drift.
    let x = baseX + vx * t;
    let y = baseY + vy * t;
    x = ((x % width) + width) % width;
    y = ((y % height) + height) % height;
    const twinkle = 0.6 + 0.4 * Math.sin(t * 2 + i * 0.7);
    const size = (starSize as number) * (0.7 + rnd(5) * 0.7);
    const colorIdx = Math.floor(rnd(6) * 3);
    const palette = [primaryColor as string, secondaryColor as string, accentColor as string];
    return { x, y, size, twinkle, color: palette[colorIdx] };
  });

  // Compute link list — only nearby pairs.
  const links: Array<{ x1: number; y1: number; x2: number; y2: number; alpha: number }> = [];
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const dx = stars[i].x - stars[j].x;
      const dy = stars[i].y - stars[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < linkD2) {
        const alpha = 1 - d2 / linkD2;
        links.push({ x1: stars[i].x, y1: stars[i].y, x2: stars[j].x, y2: stars[j].y, alpha });
      }
    }
  }

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
    }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 50%, ${primaryColor}1f, transparent 65%)`,
      }} />

      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="cn-link" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={primaryColor as string} />
            <stop offset="100%" stopColor={secondaryColor as string} />
          </linearGradient>
        </defs>

        {/* Links underneath */}
        {links.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="url(#cn-link)"
            strokeOpacity={l.alpha * 0.6}
            strokeWidth={1}
          />
        ))}

        {/* Stars on top */}
        {stars.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.size}
            fill={s.color}
            opacity={s.twinkle}
            style={{ filter: `drop-shadow(0 0 6px ${s.color})` }}
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
};
