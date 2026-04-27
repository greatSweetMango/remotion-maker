import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  values: "78,42,93,61",                         // type: text
  labels: "Engagement,Retention,Reach,Quality",  // type: text
  title: "Quarter Performance",                  // type: text
  primaryColor: "#22d3ee",                       // type: color
  secondaryColor: "#a78bfa",                     // type: color
  backgroundColor: "#0a0a14",                    // type: color
  textColor: "#ffffff",                          // type: color
  showPercent: true,                             // type: boolean
} as const;

export const ProgressBar = ({
  values = PARAMS.values,
  labels = PARAMS.labels,
  title = PARAMS.title,
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  showPercent = PARAMS.showPercent,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsedValues = String(values).split(',').map(v => Math.max(0, Math.min(100, parseFloat(v.trim()) || 0)));
  const parsedLabels = String(labels).split(',').map(l => l.trim());

  const titleOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 140px', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        color: textColor as string, fontSize: 56, fontWeight: 700,
        marginBottom: 70, opacity: titleOpacity, alignSelf: 'flex-start',
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 38, width: '100%' }}>
        {parsedValues.map((v, i) => {
          const fill = spring({ fps, frame: frame - i * 8, config: { damping: 22, stiffness: 90 } });
          const labelFade = interpolate(frame, [i * 8, i * 8 + 12], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
          const displayed = Math.round(v * fill);
          const color = i % 2 === 0 ? primaryColor : secondaryColor;
          return (
            <div key={i} style={{ width: '100%', opacity: labelFade }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: textColor as string, fontSize: 30, fontWeight: 600 }}>
                  {parsedLabels[i] || `Metric ${i + 1}`}
                </span>
                {showPercent && (
                  <span style={{ color: textColor as string, fontSize: 30, fontWeight: 700, opacity: 0.8 }}>
                    {displayed}%
                  </span>
                )}
              </div>
              <div style={{
                width: '100%', height: 22, borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${v * fill}%`, height: '100%',
                  background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                  borderRadius: 12,
                  boxShadow: `0 0 20px ${color}66`,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
