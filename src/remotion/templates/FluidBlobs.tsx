import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

// Metaball-style fluid blobs using SVG feGaussianBlur + feColorMatrix
// (the classic "goo" filter). Pure SVG, no shaders.
const PARAMS = {
  primaryColor: "#7C3AED",        // type: color
  secondaryColor: "#22d3ee",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#06061a",     // type: color
  textColor: "#ffffff",           // type: color
  blobCount: 7,                   // type: range, min: 3, max: 14
  blobSize: 220,                  // type: range, min: 80, max: 400, unit: px
  flowSpeed: 1.0,                 // type: range, min: 0.2, max: 3.0
  blur: 32,                       // type: range, min: 10, max: 80, unit: px
} as const;

export const FluidBlobs = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  blobCount = PARAMS.blobCount,
  blobSize = PARAMS.blobSize,
  flowSpeed = PARAMS.flowSpeed,
  blur = PARAMS.blur,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  void textColor;

  const count = Math.round(blobCount as number);
  const size = blobSize as number;
  const t = (frame / fps) * (flowSpeed as number);
  const palette = [primaryColor, secondaryColor, accentColor];
  const cx = width / 2;
  const cy = height / 2;
  // TM-61: ensure metaball blur is strong enough to fuse adjacent blobs at all
  // frames (including frame 0). Below ~20px stdDeviation the feColorMatrix
  // threshold leaves circles visibly separate. Floor to a sensible minimum
  // tied to blob size so customize-panel sliders can't degrade the effect.
  const effectiveBlur = Math.max(blur as number, Math.round(size * 0.18));

  const blobs = Array.from({ length: count }).map((_, i) => {
    const seed = (i + 1) * 1.93;
    const rnd = (k: number) => {
      const s = Math.sin(seed + k) * 43758.5453;
      return s - Math.floor(s);
    };
    const orbitR = 220 + rnd(1) * 360;
    const speed = 0.4 + rnd(2) * 0.9;
    const phase = rnd(3) * Math.PI * 2;
    const wobble = Math.sin(t * speed * 1.3 + phase) * 80;
    const x = cx + Math.cos(t * speed + phase) * orbitR + wobble;
    const y = cy + Math.sin(t * speed * 0.85 + phase * 1.3) * (orbitR * 0.6) + Math.cos(t * speed * 0.7) * 40;
    const r = size * (0.55 + rnd(4) * 0.55) * (0.9 + 0.1 * Math.sin(t * 2 + i));
    const color = palette[i % palette.length] as string;
    return { x, y, r, color };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, overflow: 'hidden' }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 50%, ${primaryColor}1a, transparent 70%)`,
      }} />
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          {/*
            TM-61: classic metaball "goo" pipeline. Previously this filter
            ended with `<feBlend in="SourceGraphic" in2="goo"/>` which (with
            the default `mode="normal"`) painted the un-blurred source on
            top of the threshold result — so the individual circles showed
            through and the metaball fusion was invisible at the start of
            the composition. We now end on the thresholded `goo` result and
            atop-composite a softened source for color crispness, matching
            the canonical SVG goo recipe.
          */}
          <filter id="goo" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={effectiveBlur} result="blurred" />
            <feColorMatrix
              in="blurred"
              mode="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 22 -10"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <radialGradient id="fb-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={primaryColor as string} stopOpacity="0.35" />
            <stop offset="100%" stopColor={primaryColor as string} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} fill="url(#fb-glow)" />

        <g filter="url(#goo)">
          {blobs.map((b, i) => (
            <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={b.color} />
          ))}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
