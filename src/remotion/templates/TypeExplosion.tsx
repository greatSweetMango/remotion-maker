import { useCurrentFrame, useVideoConfig, AbsoluteFill, spring, interpolate } from 'remotion';

const PARAMS = {
  text: "EXPLODE",                // type: text
  primaryColor: "#facc15",        // type: color
  secondaryColor: "#f472b6",      // type: color
  accentColor: "#22d3ee",         // type: color
  backgroundColor: "#0a0a14",     // type: color
  textColor: "#ffffff",           // type: color
  fontSize: 200,                  // type: range, min: 80, max: 320, unit: px
  explosionForce: 1.0,            // type: range, min: 0.3, max: 3.0
  stagger: 4,                     // type: range, min: 0, max: 20
} as const;

export const TypeExplosion = ({
  text = PARAMS.text,
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  fontSize = PARAMS.fontSize,
  explosionForce = PARAMS.explosionForce,
  stagger = PARAMS.stagger,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const chars = (text as string).split('');
  const force = explosionForce as number;

  // Phases (frames):
  //  0..40   : assemble in (initial)
  //  40..70  : steady
  //  70..130 : explode out
  // 130..170 : fly back / reassemble
  // 170+     : breathe
  const explodeStart = Math.floor(durationInFrames * 0.35);
  const reassembleStart = Math.floor(durationInFrames * 0.65);

  const palette = [primaryColor, secondaryColor, accentColor, textColor];

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 50%, ${primaryColor}1a, transparent 65%)`,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        {chars.map((ch, i) => {
          const seed = (i + 1) * 9.71;
          const rnd = (k: number) => {
            const s = Math.sin(seed + k) * 43758.5453;
            return s - Math.floor(s);
          };
          const enterDelay = i * (stagger as number);
          const enter = spring({
            fps,
            frame: frame - enterDelay,
            config: { damping: 12, stiffness: 160, mass: 1 },
          });

          // Direction vector for explosion
          const angle = rnd(1) * Math.PI * 2;
          const dist = (220 + rnd(2) * 480) * force;
          const spinDir = rnd(3) > 0.5 ? 1 : -1;
          const spinAmt = (180 + rnd(4) * 540) * spinDir;

          const explodeProgress = interpolate(
            frame,
            [explodeStart, explodeStart + 40],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
          const reassemble = spring({
            fps,
            frame: frame - reassembleStart - i * 1.2,
            config: { damping: 14, stiffness: 110, mass: 1 },
          });
          const explodeNow = explodeProgress * (1 - reassemble);

          const entryY = interpolate(enter, [0, 1], [-180, 0]);
          const entryScale = interpolate(enter, [0, 1], [0.4, 1]);

          const tx = Math.cos(angle) * dist * explodeNow;
          const ty = Math.sin(angle) * dist * explodeNow + entryY * (1 - explodeNow);
          const rot = spinAmt * explodeNow;
          const scale = entryScale * (1 - explodeNow * 0.6);

          const breath = Math.sin((frame / fps) * 4 + i) * 0.04;
          const finalScale = scale + (1 - explodeNow) * breath;

          const color = palette[i % palette.length] as string;

          return (
            <span key={i} style={{
              display: 'inline-block',
              fontSize: fontSize as number,
              fontWeight: 900,
              fontFamily: '"Arial Black", system-ui, sans-serif',
              letterSpacing: '-0.04em',
              color,
              textShadow: `0 0 30px ${color}66`,
              transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${finalScale})`,
              transformOrigin: 'center center',
              opacity: enter,
              willChange: 'transform',
            }}>
              {ch === ' ' ? ' ' : ch}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
