import { useCurrentFrame, useVideoConfig, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  percentage: 75,              // type: range, min: 0, max: 100
  color: "#7C3AED",            // type: color
  trackColor: "#1e1e2e",       // type: color
  backgroundColor: "#0f0f17", // type: color
  label: "Complete",           // type: text
  showNumber: true,            // type: boolean
  strokeWidth: 18,             // type: range, min: 6, max: 40, unit: px
} as const;

export const ProgressCircle = ({
  percentage = PARAMS.percentage,
  color = PARAMS.color,
  trackColor = PARAMS.trackColor,
  backgroundColor = PARAMS.backgroundColor,
  label = PARAMS.label,
  showNumber = PARAMS.showNumber,
  strokeWidth = PARAMS.strokeWidth,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const progress = spring({ fps, frame, config: { damping: 20, stiffness: 60, mass: 1 }, durationInFrames });
  const currentPct = progress * ((percentage as number) / 100);
  const currentNum = Math.round(currentPct * 100);

  const radius = 150;
  const sw = strokeWidth as number;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - currentPct);

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ position: 'relative', width: 380, height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={380} height={380} viewBox="0 0 380 380" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
          <circle cx={190} cy={190} r={radius} fill="none" stroke={trackColor as string} strokeWidth={sw} />
          <circle
            cx={190} cy={190} r={radius}
            fill="none"
            stroke={color as string}
            strokeWidth={sw}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {showNumber && (
            <div style={{
              fontSize: 80,
              fontWeight: 900,
              color: color as string,
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1,
              letterSpacing: '-0.03em',
            }}>
              {currentNum}<span style={{ fontSize: 40 }}>%</span>
            </div>
          )}
          <div style={{
            fontSize: 22,
            color: '#64748b',
            fontFamily: 'system-ui, sans-serif',
            marginTop: 10,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            {label}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
