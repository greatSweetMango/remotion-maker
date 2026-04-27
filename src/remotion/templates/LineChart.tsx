import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  values: "12,28,22,46,38,72,64,88",  // type: text
  title: "Revenue Growth",             // type: text
  primaryColor: "#22d3ee",             // type: color
  accentColor: "#a78bfa",              // type: color
  backgroundColor: "#0a0a14",          // type: color
  textColor: "#ffffff",                // type: color
  strokeWidth: 6,                      // type: range, min: 2, max: 16
  showDots: true,                      // type: boolean
  animSpeed: 1.0,                      // type: range, min: 0.3, max: 3.0
} as const;

export const LineChart = ({
  values = PARAMS.values,
  title = PARAMS.title,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  strokeWidth = PARAMS.strokeWidth,
  showDots = PARAMS.showDots,
  animSpeed = PARAMS.animSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsed = String(values).split(',').map(v => parseFloat(v.trim()) || 0);
  const maxV = Math.max(...parsed, 1);
  const minV = Math.min(...parsed, 0);
  const range = maxV - minV || 1;

  const W = 1400;
  const H = 500;
  const stepX = W / (parsed.length - 1 || 1);

  const points = parsed.map((v, i) => ({
    x: i * stepX,
    y: H - ((v - minV) / range) * H,
  }));

  const progress = spring({ fps, frame: frame * (animSpeed as number), config: { damping: 30, stiffness: 80 } });
  const titleOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  // Build path up to progress
  const totalLen = points.length - 1;
  const cutoff = totalLen * progress;
  const drawPath = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    if (i <= cutoff) return `${acc} L ${p.x} ${p.y}`;
    if (i - 1 < cutoff) {
      const prev = points[i - 1];
      const t = cutoff - (i - 1);
      const x = prev.x + (p.x - prev.x) * t;
      const y = prev.y + (p.y - prev.y) * t;
      return `${acc} L ${x} ${y}`;
    }
    return acc;
  }, '');

  const areaPath = `${drawPath} L ${Math.min(cutoff, totalLen) * stepX} ${H} L 0 ${H} Z`;

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 100px', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        color: textColor as string, fontSize: 56, fontWeight: 700,
        marginBottom: 50, opacity: titleOpacity, letterSpacing: '-0.02em',
      }}>{title}</div>
      <svg width={W} height={H + 40} viewBox={`-20 -20 ${W + 40} ${H + 40}`}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor as string} stopOpacity="0.4" />
            <stop offset="100%" stopColor={primaryColor as string} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#lineGrad)" />
        <path d={drawPath} fill="none" stroke={primaryColor as string} strokeWidth={strokeWidth as number} strokeLinecap="round" strokeLinejoin="round" />
        {showDots && points.map((p, i) => {
          if (i > cutoff) return null;
          const dotScale = spring({ fps, frame: frame - i * 4, config: { damping: 12, stiffness: 200 } });
          return (
            <circle key={i} cx={p.x} cy={p.y} r={(strokeWidth as number) * 1.4 * dotScale}
              fill={accentColor as string} stroke={backgroundColor as string} strokeWidth="3" />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
