import { useCurrentFrame, interpolate, AbsoluteFill } from 'remotion';

const PARAMS = {
  fromText: "Before",                  // type: text
  toText: "After",                     // type: text
  primaryColor: "#7C3AED",             // type: color
  accentColor: "#22d3ee",              // type: color
  backgroundColor: "#0a0a14",          // type: color
  textColor: "#ffffff",                // type: color
  zoomMidFrame: 30,                    // type: range, min: 12, max: 90, unit: frames
} as const;

export const ZoomTransition = ({
  fromText = PARAMS.fromText,
  toText = PARAMS.toText,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  zoomMidFrame = PARAMS.zoomMidFrame,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const mid = zoomMidFrame as number;

  // First half: zoom in fromText
  const zoom1 = interpolate(frame, [0, mid], [1, 8], { extrapolateRight: 'clamp' });
  const fade1 = interpolate(frame, [mid - 8, mid], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Second half: zoom out toText
  const zoom2 = interpolate(frame, [mid, mid + 24], [8, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fade2 = interpolate(frame, [mid, mid + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const flash = interpolate(frame, [mid - 4, mid, mid + 4], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: `radial-gradient(circle at center, ${primaryColor}22, ${backgroundColor})`,
      backgroundColor: backgroundColor as string,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
    }}>
      {frame < mid && (
        <div style={{
          fontSize: 200, fontWeight: 900,
          color: textColor as string,
          transform: `scale(${zoom1})`, opacity: fade1,
          textShadow: `0 0 40px ${primaryColor}`,
        }}>{fromText}</div>
      )}
      {frame >= mid && (
        <div style={{
          fontSize: 200, fontWeight: 900,
          color: textColor as string,
          transform: `scale(${zoom2})`, opacity: fade2,
          textShadow: `0 0 40px ${accentColor}`,
        }}>{toText}</div>
      )}
      <AbsoluteFill style={{
        backgroundColor: '#ffffff',
        opacity: flash * 0.85,
        pointerEvents: 'none',
      }} />
    </AbsoluteFill>
  );
};
