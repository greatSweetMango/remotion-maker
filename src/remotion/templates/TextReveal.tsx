import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill } from 'remotion';

const PARAMS = {
  text: "HELLO WORLD",        // type: text
  primaryColor: "#ffffff",     // type: color
  accentColor: "#7C3AED",     // type: color
  backgroundColor: "#0a0a12", // type: color
  fontSize: 100,              // type: range, min: 30, max: 200, unit: px
  stagger: 3,                 // type: range, min: 1, max: 8
} as const;

export const TextReveal = ({
  text = PARAMS.text,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  stagger = PARAMS.stagger,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = (text as string).split('');

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        {chars.map((char, i) => {
          const delay = i * (stagger as number);
          const progress = spring({ fps, frame: frame - delay, config: { damping: 14, stiffness: 200, mass: 0.8 } });
          const y = interpolate(progress, [0, 1], [80, 0]);
          return (
            <span key={i} style={{
              display: 'inline-block',
              fontSize: fontSize as number,
              fontWeight: 900,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: i % 3 === 2 ? accentColor as string : primaryColor as string,
              transform: `translateY(${y}px)`,
              opacity: progress,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              marginRight: char === ' ' ? (fontSize as number) * 0.3 : 0,
            }}>
              {char === ' ' ? '' : char}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
