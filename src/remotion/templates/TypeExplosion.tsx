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

  // Phase plan (fractions of durationInFrames):
  //  0.00 .. 0.15 : assemble in (per-char spring stagger)
  //  0.15 .. 0.30 : steady (initial headline)
  //  0.30 .. 0.50 : explode out  (explodeStart .. explodeEnd)
  //  0.55 .. 0.80 : reassemble back to headline (visible fly-back motion)
  //  0.80 .. 1.00 : steady + subtle breathe (final headline)
  //
  // The earlier curve squeezed reassembly into the last ~10% of the timeline
  // so the visual audit (TM-43) only ever saw the explosion phase. The fix
  // moves explode earlier, gives reassembly its own ~25% window with a slow
  // spring so the fly-back is clearly visible, and ends on a held headline.
  const explodeStart = Math.floor(durationInFrames * 0.30);
  const explodeEnd = Math.floor(durationInFrames * 0.50);
  const reassembleStart = Math.floor(durationInFrames * 0.55);

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

          // Direction vector for explosion. Distance is bounded so chars
          // stay roughly on screen at default force (1920x1080 canvas).
          const angle = rnd(1) * Math.PI * 2;
          const dist = (180 + rnd(2) * 360) * force;
          const spinDir = rnd(3) > 0.5 ? 1 : -1;
          const spinAmt = (180 + rnd(4) * 540) * spinDir;

          const explodeProgress = interpolate(
            frame,
            [explodeStart, explodeEnd],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
          // Reassembly: fast enough that the return-to-headline is clearly
          // visible within the reassembly window, with mild per-char stagger.
          const reassemble = spring({
            fps,
            frame: frame - reassembleStart - i * 2,
            // Lower stiffness + slightly higher mass = visibly slower
            // fly-back so the reassembly motion reads on screen instead of
            // snapping. Tuned so the spring reaches ~1 around durationInFrames * 0.8.
            config: { damping: 22, stiffness: 60, mass: 1.2 },
          });
          // explodeNow drives outward motion; (1 - reassemble) pulls it home.
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
