import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill } from 'remotion';

const PARAMS = {
  line1: "BREAK",              // type: text
  line2: "FREE",               // type: text
  color1: "#7C3AED",           // type: color
  color2: "#EC4899",           // type: color
  backgroundColor: "#0a0a12", // type: color
  fontSize: 160,               // type: range, min: 60, max: 260, unit: px
  gap: 20,                     // type: range, min: 0, max: 160, unit: px
} as const;

export const SplitText = ({
  line1 = PARAMS.line1,
  line2 = PARAMS.line2,
  color1 = PARAMS.color1,
  color2 = PARAMS.color2,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  gap = PARAMS.gap,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const p1 = spring({ fps, frame, config: { damping: 16, stiffness: 140, mass: 1 } });
  const p2 = spring({ fps, frame: frame - 6, config: { damping: 16, stiffness: 140, mass: 1 } });

  const x1 = interpolate(p1, [0, 1], [-900, 0]);
  const x2 = interpolate(p2, [0, 1], [900, 0]);

  const textStyle = {
    fontWeight: 900,
    fontFamily: '"Arial Black", system-ui, sans-serif',
    letterSpacing: '-0.03em',
    lineHeight: 1,
    fontSize: fontSize as number,
  };

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: gap as number,
      overflow: 'hidden',
    }}>
      <div style={{ transform: `translateX(${x1}px)` }}>
        <span style={{ ...textStyle, color: color1 as string }}>{line1}</span>
      </div>
      <div style={{ transform: `translateX(${x2}px)` }}>
        <span style={{ ...textStyle, color: color2 as string }}>{line2}</span>
      </div>
    </AbsoluteFill>
  );
};
