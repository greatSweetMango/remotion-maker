import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  prefix: "Build it",                                       // type: text
  words: "faster,better,smarter,together",                  // type: text
  primaryColor: "#7C3AED",                                  // type: color
  accentColor: "#22d3ee",                                   // type: color
  backgroundColor: "#0a0a14",                               // type: color
  textColor: "#ffffff",                                     // type: color
  fontSize: 140,                                            // type: range, min: 60, max: 240
  swapDuration: 30,                                         // type: range, min: 12, max: 90, unit: frames
} as const;

export const RotatingText = ({
  prefix = PARAMS.prefix,
  words = PARAMS.words,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  fontSize = PARAMS.fontSize,
  swapDuration = PARAMS.swapDuration,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const list = String(words).split(',').map(s => s.trim()).filter(Boolean);
  const idx = Math.floor(frame / (swapDuration as number)) % list.length;
  const localFrame = frame % (swapDuration as number);

  const enter = spring({ fps, frame: localFrame, config: { damping: 18, stiffness: 160 } });
  const exit = (swapDuration as number) - localFrame < 8
    ? interpolate((swapDuration as number) - localFrame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1;

  const prefixOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        fontSize: fontSize as number, fontWeight: 800,
        color: textColor as string, display: 'flex', alignItems: 'center', gap: 24,
      }}>
        <span style={{ opacity: prefixOpacity }}>{prefix}</span>
        <span style={{
          background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          opacity: enter * exit,
          transform: `translateY(${(1 - enter) * 60}px) scale(${0.7 + 0.3 * enter})`,
          display: 'inline-block',
        }}>{list[idx] || ''}</span>
      </div>
    </AbsoluteFill>
  );
};
