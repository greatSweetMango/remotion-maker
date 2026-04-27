import { useCurrentFrame, useVideoConfig, AbsoluteFill, interpolate } from 'remotion';

// Animated bezier path: stroke-dashoffset draw-on with secondary echo trail.
// Pure SVG. The path is procedurally generated as a smooth multi-segment curve
// so the user can re-render with different `seed` values for variety.
const PARAMS = {
  primaryColor: "#7C3AED",        // type: color
  secondaryColor: "#22d3ee",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#06060f",     // type: color
  textColor: "#ffffff",           // type: color
  strokeWidth: 8,                 // type: range, min: 1, max: 24, unit: px
  segments: 6,                    // type: range, min: 3, max: 12
  glow: 24,                       // type: range, min: 0, max: 80, unit: px
  drawSpeed: 1.0,                 // type: range, min: 0.2, max: 3.0
  seed: 7,                        // type: range, min: 1, max: 100
} as const;

export const BezierPath = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  strokeWidth = PARAMS.strokeWidth,
  segments = PARAMS.segments,
  glow = PARAMS.glow,
  drawSpeed = PARAMS.drawSpeed,
  seed = PARAMS.seed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  void textColor;

  // Deterministic pseudo-random per seed (no Math.random — keeps render stable).
  const rnd = (k: number) => {
    const s = Math.sin((seed as number) * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  // Build a meandering cubic-bezier path across the canvas.
  const segCount = Math.max(3, Math.round(segments as number));
  const padX = width * 0.12;
  const padY = height * 0.18;
  let d = '';
  for (let i = 0; i <= segCount; i++) {
    const t = i / segCount;
    const x = padX + (width - 2 * padX) * t;
    const y = padY + (height - 2 * padY) * (0.5 + 0.45 * Math.sin(t * Math.PI * 2 + rnd(i) * 6.28));
    if (i === 0) {
      d += `M ${x.toFixed(2)} ${y.toFixed(2)} `;
    } else {
      const prevT = (i - 1) / segCount;
      const prevX = padX + (width - 2 * padX) * prevT;
      const prevY = padY + (height - 2 * padY) * (0.5 + 0.45 * Math.sin(prevT * Math.PI * 2 + rnd(i - 1) * 6.28));
      const c1x = prevX + (x - prevX) * 0.35;
      const c1y = prevY + (rnd(i + 100) - 0.5) * height * 0.45;
      const c2x = prevX + (x - prevX) * 0.65;
      const c2y = y + (rnd(i + 200) - 0.5) * height * 0.45;
      d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
  }

  // Path-length estimate is unstable in SSR; we use a generous constant
  // big enough for any reasonable canvas, then animate dashoffset linearly.
  const PATH_LEN = 6000;
  const speed = Math.max(0.05, drawSpeed as number);
  const total = durationInFrames > 0 ? durationInFrames : fps * 6;
  const drawProgress = Math.min(1, (frame / total) * speed);
  const dashOffset = PATH_LEN * (1 - drawProgress);

  // Echo trail lags behind for depth.
  const echoOffset = PATH_LEN * (1 - Math.max(0, drawProgress - 0.08));
  const headT = interpolate(frame, [0, total], [0, 1], { extrapolateRight: 'clamp' });

  // Estimate head position by sampling along t (rough; visual only).
  const headX = padX + (width - 2 * padX) * headT;
  const headY = padY + (height - 2 * padY) * (0.5 + 0.45 * Math.sin(headT * Math.PI * 2 + rnd(Math.floor(headT * segCount)) * 6.28));

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
    }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 50%, ${primaryColor}22, transparent 65%)`,
      }} />
      <svg width={width} height={height} style={{
        position: 'absolute',
        inset: 0,
        filter: `drop-shadow(0 0 ${glow}px ${primaryColor})`,
      }}>
        <defs>
          <linearGradient id="bz-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={primaryColor as string} />
            <stop offset="50%" stopColor={secondaryColor as string} />
            <stop offset="100%" stopColor={accentColor as string} />
          </linearGradient>
        </defs>

        {/* Echo trail */}
        <path
          d={d}
          fill="none"
          stroke={accentColor as string}
          strokeOpacity={0.45}
          strokeWidth={(strokeWidth as number) * 0.55}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LEN}
          strokeDashoffset={echoOffset}
        />

        {/* Main stroke */}
        <path
          d={d}
          fill="none"
          stroke="url(#bz-grad)"
          strokeWidth={strokeWidth as number}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LEN}
          strokeDashoffset={dashOffset}
        />

        {/* Head dot */}
        {drawProgress < 1 && (
          <circle
            cx={headX}
            cy={headY}
            r={(strokeWidth as number) * 1.4}
            fill={primaryColor as string}
          />
        )}
      </svg>
    </AbsoluteFill>
  );
};
