import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill } from 'remotion';

const PARAMS = {
  name: "Alex Johnson",        // type: text
  title: "Senior Developer",   // type: text
  accentColor: "#7C3AED",     // type: color
  backgroundColor: "#0f172a", // type: color
  textColor: "#ffffff",        // type: color
  barHeight: 4,                // type: range, min: 2, max: 16, unit: px
} as const;

export const LowerThird = ({
  name = PARAMS.name,
  title = PARAMS.title,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  barHeight = PARAMS.barHeight,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({ fps, frame, config: { damping: 20, stiffness: 200, mass: 0.8 } });
  const titleSlide = spring({ fps, frame: frame - 8, config: { damping: 20, stiffness: 200, mass: 0.8 } });
  const barScale = spring({ fps, frame: frame - 4, config: { damping: 25, stiffness: 150 } });

  const x1 = interpolate(slideIn, [0, 1], [-500, 0]);
  const x2 = interpolate(titleSlide, [0, 1], [-400, 0]);

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string }}>
      <div style={{
        position: 'absolute',
        bottom: 130,
        left: 90,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div style={{ transform: `translateX(${x1}px)` }}>
          <div style={{
            fontSize: 56,
            fontWeight: 900,
            color: textColor as string,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '-0.01em',
            lineHeight: 1,
          }}>
            {name}
          </div>
        </div>

        <div style={{
          width: `${barScale * 220}px`,
          height: barHeight as number,
          backgroundColor: accentColor as string,
          borderRadius: (barHeight as number) / 2,
        }} />

        <div style={{ transform: `translateX(${x2}px)` }}>
          <div style={{
            fontSize: 28,
            fontWeight: 600,
            color: accentColor as string,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.03em',
          }}>
            {title}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
