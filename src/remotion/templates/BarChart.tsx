import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  values: "42,78,56,91,63",     // type: text
  labels: "Mon,Tue,Wed,Thu,Fri", // type: text
  primaryColor: "#7C3AED",       // type: color
  secondaryColor: "#A78BFA",     // type: color
  backgroundColor: "#0f0f17",    // type: color
  title: "Weekly Progress",      // type: text
  showValues: true,              // type: boolean
  animSpeed: 1.0,                // type: range, min: 0.3, max: 3.0
} as const;

export const BarChart = ({
  values = PARAMS.values,
  labels = PARAMS.labels,
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  backgroundColor = PARAMS.backgroundColor,
  title = PARAMS.title,
  showValues = PARAMS.showValues,
  animSpeed = PARAMS.animSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsedValues = String(values).split(',').map(v => parseFloat(v.trim()) || 0);
  const parsedLabels = String(labels).split(',').map(l => l.trim());
  const maxValue = Math.max(...parsedValues, 1);

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [0, 15], [20, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 100px 100px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        color: 'white',
        fontSize: 48,
        fontWeight: 700,
        marginBottom: 60,
        opacity: titleOpacity,
        transform: `translateY(${titleY}px)`,
        letterSpacing: '-0.02em',
      }}>
        {title}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, width: '100%', height: 400 }}>
        {parsedValues.map((value, i) => {
          const barFrame = frame - i * (6 / (animSpeed as number));
          const barHeight = spring({
            fps,
            frame: Math.max(0, barFrame),
            config: { damping: 20, stiffness: 120 },
          });

          const heightPercent = (value / maxValue) * barHeight;
          const label = parsedLabels[i] || `Item ${i + 1}`;

          const barColor = i % 2 === 0 ? primaryColor : secondaryColor;

          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              {showValues && (
                <div style={{
                  color: 'white',
                  fontSize: 28,
                  fontWeight: 700,
                  opacity: barHeight,
                }}>
                  {Math.round(value * barHeight)}
                </div>
              )}
              <div style={{
                width: '100%',
                height: `${heightPercent * 100}%`,
                backgroundColor: barColor as string,
                borderRadius: '8px 8px 0 0',
                minHeight: 4,
                boxShadow: `0 0 20px ${barColor}66`,
              }} />
              <div style={{ color: '#9ca3af', fontSize: 24, fontWeight: 500 }}>{label}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
