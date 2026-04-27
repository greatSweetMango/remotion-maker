import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  values: "45,25,18,12",                          // type: text
  labels: "Mobile,Desktop,Tablet,Other",          // type: text
  title: "Traffic Sources",                       // type: text
  centerLabel: "100%",                            // type: text
  primaryColor: "#7C3AED",                        // type: color
  secondaryColor: "#22d3ee",                      // type: color
  accentColor: "#f472b6",                         // type: color
  backgroundColor: "#0a0a14",                     // type: color
  textColor: "#ffffff",                           // type: color
  thickness: 60,                                  // type: range, min: 20, max: 120
} as const;

export const DonutChart = ({
  values = PARAMS.values,
  labels = PARAMS.labels,
  title = PARAMS.title,
  centerLabel = PARAMS.centerLabel,
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  thickness = PARAMS.thickness,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsedValues = String(values).split(',').map(v => parseFloat(v.trim()) || 0);
  const parsedLabels = String(labels).split(',').map(l => l.trim());
  const total = parsedValues.reduce((a, b) => a + b, 0) || 1;

  const palette = [primaryColor, secondaryColor, accentColor, '#fbbf24', '#34d399', '#f87171'];

  const R = 220;
  const CX = 400;
  const CY = 280;

  const titleOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const sweep = spring({ fps, frame, config: { damping: 30, stiffness: 60 } });

  // Pre-compute cumulative start angles (no reassignment after render)
  const startAngles: number[] = [];
  parsedValues.reduce((acc, v) => {
    startAngles.push(acc);
    return acc + (v / total) * Math.PI * 2;
  }, -Math.PI / 2);

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 80 }}>
        <svg width="800" height="560" viewBox="0 0 800 560">
          <text x={CX} y={60} textAnchor="middle" fill={textColor as string}
            fontSize={42} fontWeight={700} opacity={titleOpacity}>{title}</text>
          {parsedValues.map((v, i) => {
            const slice = (v / total) * Math.PI * 2;
            const startAngle = startAngles[i];
            const endAngle = startAngle + slice * sweep;
            const largeArc = slice * sweep > Math.PI ? 1 : 0;
            const x1 = CX + R * Math.cos(startAngle);
            const y1 = CY + R * Math.sin(startAngle);
            const x2 = CX + R * Math.cos(endAngle);
            const y2 = CY + R * Math.sin(endAngle);
            const path = `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
            const color = palette[i % palette.length] as string;
            return <path key={i} d={path} fill={color} />;
          })}
          <circle cx={CX} cy={CY} r={R - (thickness as number)} fill={backgroundColor as string} />
          <text x={CX} y={CY + 4} textAnchor="middle" fill={textColor as string}
            fontSize={64} fontWeight={800}>{centerLabel}</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {parsedValues.map((v, i) => {
            const pct = ((v / total) * 100).toFixed(0);
            const itemFade = interpolate(frame, [20 + i * 6, 35 + i * 6], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: itemFade }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: palette[i % palette.length] as string }} />
                <div style={{ color: textColor as string, fontSize: 28, fontWeight: 600 }}>
                  {parsedLabels[i] || `Item ${i + 1}`} <span style={{ opacity: 0.6 }}>· {pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
