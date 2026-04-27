import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

// Vector flow field driven by a cheap 2D value-noise (hash + smoothstep).
// Particles trace the field; we pre-simulate up to current frame to keep
// the field deterministic.
const PARAMS = {
  primaryColor: "#22d3ee",        // type: color
  secondaryColor: "#a78bfa",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#04040a",     // type: color
  textColor: "#ffffff",           // type: color
  particleCount: 90,              // type: range, min: 20, max: 200
  flowSpeed: 1.2,                 // type: range, min: 0.2, max: 4.0
  noiseScale: 0.0035,             // type: range, min: 0.001, max: 0.012
  trailLength: 14,                // type: range, min: 4, max: 40
} as const;

export const FlowField = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  particleCount = PARAMS.particleCount,
  flowSpeed = PARAMS.flowSpeed,
  noiseScale = PARAMS.noiseScale,
  trailLength = PARAMS.trailLength,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  void textColor;

  const count = Math.round(particleCount as number);
  const trail = Math.round(trailLength as number);
  const speed = (flowSpeed as number) * 2.5;
  const ns = noiseScale as number;
  const t = frame / fps;

  // Hash-based value noise. Cheap but coherent enough for a flow field.
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (a: number) => a * a * (3 - 2 * a);
  const noise2D = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = smooth(xf);
    const v = smooth(yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const angleAt = (x: number, y: number, time: number) => {
    const n = noise2D(x * ns + time * 0.2, y * ns);
    return n * Math.PI * 4;
  };

  const palette = [primaryColor, secondaryColor, accentColor];

  type Trail = { points: Array<{ x: number; y: number }>; color: string; size: number };
  const trails: Trail[] = [];

  for (let i = 0; i < count; i++) {
    const seed = (i + 1) * 0.7321;
    const rnd = (k: number) => {
      const s = Math.sin(seed + k) * 43758.5453;
      return s - Math.floor(s);
    };
    let x = rnd(1) * width;
    let y = rnd(2) * height;
    const points: Array<{ x: number; y: number }> = [];
    // pre-simulate forward to current frame
    const totalSteps = Math.min(frame + trail, 600);
    for (let f = 0; f < totalSteps; f++) {
      const a = angleAt(x, y, f / fps);
      x += Math.cos(a) * speed;
      y += Math.sin(a) * speed;
      // wrap
      if (x < 0) x += width;
      if (x > width) x -= width;
      if (y < 0) y += height;
      if (y > height) y -= height;
      if (f >= totalSteps - trail) {
        points.push({ x, y });
      }
    }
    trails.push({
      points,
      color: palette[i % palette.length] as string,
      size: 3 + rnd(3) * 5,
    });
  }
  void t;

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, overflow: 'hidden' }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 30% 30%, ${primaryColor}1f, transparent 55%), radial-gradient(circle at 70% 80%, ${accentColor}1a, transparent 55%)`,
      }} />
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {trails.map((tr, i) => {
          if (tr.points.length === 0) return null;
          const d = tr.points
            .map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(' ');
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={tr.color} strokeWidth={tr.size * 0.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} />
              {tr.points.length > 0 && (
                <circle
                  cx={tr.points[tr.points.length - 1].x}
                  cy={tr.points[tr.points.length - 1].y}
                  r={tr.size}
                  fill={tr.color}
                  opacity={0.95}
                />
              )}
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
