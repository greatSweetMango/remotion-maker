import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  values: "20,32,28,48,42,60,55,78,72,90",  // type: text
  title: "Monthly Active Users",              // type: text
  subtitle: "Last 10 months",                 // type: text
  primaryColor: "#7C3AED",                    // type: color
  accentColor: "#f472b6",                     // type: color
  backgroundColor: "#0f0f17",                 // type: color
  textColor: "#ffffff",                       // type: color
  showGrid: true,                             // type: boolean
} as const;

export const AreaChart = ({
  values = PARAMS.values,
  title = PARAMS.title,
  subtitle = PARAMS.subtitle,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  showGrid = PARAMS.showGrid,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsed = String(values).split(',').map(v => parseFloat(v.trim()) || 0);
  const maxV = Math.max(...parsed, 1);

  const W = 1500;
  const H = 480;
  const stepX = W / (parsed.length - 1 || 1);

  const reveal = spring({ fps, frame, config: { damping: 28, stiffness: 70 } });
  const titleOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const subOpacity = interpolate(frame, [10, 28], [0, 1], { extrapolateRight: 'clamp' });

  const visibleW = W * reveal;

  const points = parsed.map((v, i) => `${i * stepX},${H - (v / maxV) * H}`).join(' ');
  const polyPath = `M 0 ${H} L ${parsed.map((v, i) => `${i * stepX} ${H - (v / maxV) * H}`).join(' L ')} L ${(parsed.length - 1) * stepX} ${H} Z`;

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '60px 100px', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ alignSelf: 'flex-start', marginBottom: 40 }}>
        <div style={{ color: textColor as string, fontSize: 56, fontWeight: 700, opacity: titleOpacity }}>{title}</div>
        <div style={{ color: textColor as string, fontSize: 26, fontWeight: 400, opacity: 0.6 * subOpacity, marginTop: 6 }}>{subtitle}</div>
      </div>
      <svg width={W} height={H + 20} viewBox={`0 0 ${W} ${H + 20}`}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor as string} stopOpacity="0.85" />
            <stop offset="100%" stopColor={accentColor as string} stopOpacity="0.1" />
          </linearGradient>
          <clipPath id="reveal"><rect x="0" y="0" width={visibleW} height={H + 20} /></clipPath>
        </defs>
        {showGrid && [0.25, 0.5, 0.75].map((t, i) => (
          <line key={i} x1="0" y1={H * t} x2={W} y2={H * t}
            stroke={textColor as string} strokeOpacity="0.08" strokeDasharray="6 6" />
        ))}
        <g clipPath="url(#reveal)">
          <path d={polyPath} fill="url(#areaGrad)" />
          <polyline points={points} fill="none" stroke={primaryColor as string} strokeWidth="5" strokeLinejoin="round" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
