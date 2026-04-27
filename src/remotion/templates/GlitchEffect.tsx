import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

// VHS / chromatic-aberration glitch headline.
// Three RGB channels are rendered as separate text layers with mix-blend-mode: screen,
// each independently jittered. Scan lines are pure CSS gradient; tear bands cycle on
// pseudo-random frame buckets so the effect is varied but deterministic.
const PARAMS = {
  primaryColor: "#ff2e6c",        // type: color
  secondaryColor: "#21f6ff",      // type: color
  accentColor: "#fffb00",         // type: color
  backgroundColor: "#0a0a14",     // type: color
  textColor: "#ffffff",           // type: color
  message: "GLITCH",              // type: text
  fontSize: 220,                  // type: range, min: 60, max: 400, unit: px
  intensity: 1.0,                 // type: range, min: 0.0, max: 3.0
  scanlineOpacity: 0.25,          // type: range, min: 0.0, max: 1.0
} as const;

export const GlitchEffect = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  message = PARAMS.message,
  fontSize = PARAMS.fontSize,
  intensity = PARAMS.intensity,
  scanlineOpacity = PARAMS.scanlineOpacity,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Deterministic frame-bucket noise (changes every 3 frames — feels jittery).
  const bucket = Math.floor(frame / 3);
  const rnd = (k: number) => {
    const s = Math.sin(bucket * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  const i = intensity as number;
  const rOff = (rnd(1) - 0.5) * 24 * i;
  const gOff = (rnd(2) - 0.5) * 18 * i;
  const bOff = (rnd(3) - 0.5) * 24 * i;

  // Tear band: sometimes shift the whole frame horizontally.
  const tearTrigger = rnd(7);
  const tearShift = tearTrigger > 0.85 ? (rnd(8) - 0.5) * 60 * i : 0;
  const tearY = rnd(9) * height;
  const tearH = 30 + rnd(10) * 80;

  // Subtle skew flicker.
  const skew = (rnd(11) - 0.5) * 4 * i;

  const baseTextStyle: React.CSSProperties = {
    position: 'absolute',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontWeight: 900,
    fontSize: `${fontSize}px`,
    letterSpacing: '0.02em',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    transform: `translate(-50%, -50%) skewX(${skew}deg) translateX(${tearShift}px)`,
    left: '50%',
    top: '50%',
    pointerEvents: 'none',
    userSelect: 'none',
  };

  void fps;

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
    }}>
      {/* CRT vignette */}
      <AbsoluteFill style={{
        background: `radial-gradient(ellipse at center, transparent 50%, ${backgroundColor}cc 100%)`,
        pointerEvents: 'none',
      }} />

      {/* Three RGB-ish channels via mix-blend-mode: screen */}
      <div
        style={{
          ...baseTextStyle,
          color: primaryColor as string,
          transform: `translate(calc(-50% + ${rOff}px), calc(-50% + ${rOff * 0.3}px)) skewX(${skew}deg) translateX(${tearShift}px)`,
          mixBlendMode: 'screen',
        }}
      >{message}</div>
      <div
        style={{
          ...baseTextStyle,
          color: secondaryColor as string,
          transform: `translate(calc(-50% + ${gOff}px), calc(-50% + ${-gOff * 0.4}px)) skewX(${skew}deg) translateX(${tearShift}px)`,
          mixBlendMode: 'screen',
        }}
      >{message}</div>
      <div
        style={{
          ...baseTextStyle,
          color: accentColor as string,
          transform: `translate(calc(-50% + ${bOff}px), calc(-50% + ${bOff * 0.2}px)) skewX(${skew}deg) translateX(${tearShift}px)`,
          mixBlendMode: 'screen',
        }}
      >{message}</div>

      {/* White core */}
      <div
        style={{
          ...baseTextStyle,
          color: textColor as string,
          opacity: 0.92,
        }}
      >{message}</div>

      {/* Tear band (horizontal slice over the headline) */}
      {tearTrigger > 0.85 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: tearY,
            width,
            height: tearH,
            background: `linear-gradient(180deg, transparent, ${primaryColor}33, transparent)`,
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Scan lines */}
      <AbsoluteFill style={{
        backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,${scanlineOpacity}) 0px, rgba(0,0,0,${scanlineOpacity}) 1px, transparent 2px, transparent 4px)`,
        pointerEvents: 'none',
        mixBlendMode: 'multiply',
      }} />
    </AbsoluteFill>
  );
};
