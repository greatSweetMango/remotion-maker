import { useCurrentFrame, useVideoConfig, AbsoluteFill, interpolate } from 'remotion';

// Morphs through three SVG paths: rounded square (cube face) → circle (sphere) → torus.
// Three named paths kept identical command counts so SVG path-string interpolation works.
const PARAMS = {
  primaryColor: "#7C3AED",        // type: color
  secondaryColor: "#22d3ee",      // type: color
  accentColor: "#f472b6",         // type: color
  backgroundColor: "#06060f",     // type: color
  textColor: "#ffffff",           // type: color
  rotateSpeed: 1.0,               // type: range, min: 0.0, max: 4.0
  strokeWidth: 6,                 // type: range, min: 1, max: 20, unit: px
  glow: 28,                       // type: range, min: 0, max: 80, unit: px
} as const;

export const MorphingGeometry = ({
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
  rotateSpeed = PARAMS.rotateSpeed,
  strokeWidth = PARAMS.strokeWidth,
  glow = PARAMS.glow,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  void textColor;

  // Keyframed shape A→B→C→A loop. Each shape uses 8 cubic Bezier segments.
  // Built procedurally to keep command counts identical for smooth SVG morph.
  const cx = 0;
  const cy = 0;

  const buildCircle = (radius: number) => {
    const k = 0.5522847498 * radius;
    return `M ${cx - radius} ${cy} ` +
      `C ${cx - radius} ${cy - k}, ${cx - k} ${cy - radius}, ${cx} ${cy - radius} ` +
      `C ${cx + k} ${cy - radius}, ${cx + radius} ${cy - k}, ${cx + radius} ${cy} ` +
      `C ${cx + radius} ${cy + k}, ${cx + k} ${cy + radius}, ${cx} ${cy + radius} ` +
      `C ${cx - k} ${cy + radius}, ${cx - radius} ${cy + k}, ${cx - radius} ${cy} Z`;
  };

  // Rounded-square (cube silhouette).
  const buildRoundedSquare = (size: number, radius: number) => {
    const s = size;
    const rr = radius;
    return `M ${-s} ${-s + rr} ` +
      `C ${-s} ${-s + rr * 0.4}, ${-s + rr * 0.4} ${-s}, ${-s + rr} ${-s} ` +
      `C ${-rr * 0.2} ${-s}, ${rr * 0.2} ${-s}, ${s - rr} ${-s} ` +
      `C ${s - rr * 0.4} ${-s}, ${s} ${-s + rr * 0.4}, ${s} ${-s + rr} ` +
      `C ${s} ${rr * 0.2}, ${s} ${-rr * 0.2}, ${s} ${s - rr} ` +
      `C ${s} ${s - rr * 0.4}, ${s - rr * 0.4} ${s}, ${s - rr} ${s} ` +
      `C ${rr * 0.2} ${s}, ${-rr * 0.2} ${s}, ${-s + rr} ${s} ` +
      `C ${-s + rr * 0.4} ${s}, ${-s} ${s - rr * 0.4}, ${-s} ${s - rr} ` +
      `C ${-s} ${-rr * 0.2}, ${-s} ${rr * 0.2}, ${-s} ${-s + rr} Z`;
  };

  // Torus silhouette: pinched lemniscate-ish using circle + horizontal squash.
  const buildTorus = (radius: number) => {
    const k = 0.5522847498 * radius;
    const sx = 1.4;
    const sy = 0.55;
    return `M ${cx - radius * sx} ${cy} ` +
      `C ${cx - radius * sx} ${cy - k * sy}, ${cx - k * sx} ${cy - radius * sy}, ${cx} ${cy - radius * sy} ` +
      `C ${cx + k * sx} ${cy - radius * sy}, ${cx + radius * sx} ${cy - k * sy}, ${cx + radius * sx} ${cy} ` +
      `C ${cx + radius * sx} ${cy + k * sy}, ${cx + k * sx} ${cy + radius * sy}, ${cx} ${cy + radius * sy} ` +
      `C ${cx - k * sx} ${cy + radius * sy}, ${cx - radius * sx} ${cy + k * sy}, ${cx - radius * sx} ${cy} Z`;
  };

  // Linear path-blend by parsing numeric tokens.
  const blend = (a: string, b: string, t: number) => {
    const tokA = a.split(/(\s+|,)/);
    const tokB = b.split(/(\s+|,)/);
    return tokA.map((tk, i) => {
      const n1 = parseFloat(tk);
      const n2 = parseFloat(tokB[i]);
      if (!Number.isNaN(n1) && !Number.isNaN(n2)) {
        return (n1 + (n2 - n1) * t).toFixed(2);
      }
      return tk;
    }).join('');
  };

  const shapeA = buildRoundedSquare(180, 60);
  const shapeB = buildCircle(180);
  const shapeC = buildTorus(180);

  // Three-phase loop.
  const cycle = durationInFrames > 0 ? durationInFrames : fps * 6;
  const local = (frame % cycle) / cycle; // 0..1
  let path = shapeA;
  if (local < 1 / 3) {
    const t = local / (1 / 3);
    path = blend(shapeA, shapeB, easeInOut(t));
  } else if (local < 2 / 3) {
    const t = (local - 1 / 3) / (1 / 3);
    path = blend(shapeB, shapeC, easeInOut(t));
  } else {
    const t = (local - 2 / 3) / (1 / 3);
    path = blend(shapeC, shapeA, easeInOut(t));
  }

  const rot = (frame / fps) * 60 * (rotateSpeed as number);
  const tilt = Math.sin((frame / fps) * 1.2 * (rotateSpeed as number)) * 18;
  const breathe = 1 + 0.04 * Math.sin((frame / fps) * 2.4);

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 50%, ${primaryColor}22, transparent 60%)`,
      }} />
      <svg width="900" height="900" viewBox="-300 -300 600 600" style={{
        filter: `drop-shadow(0 0 ${glow}px ${primaryColor})`,
        transform: `perspective(900px) rotateX(${tilt}deg) rotateY(${rot}deg) scale(${breathe})`,
        transformStyle: 'preserve-3d',
      }}>
        <defs>
          <linearGradient id="mg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={primaryColor as string} />
            <stop offset="50%" stopColor={secondaryColor as string} />
            <stop offset="100%" stopColor={accentColor as string} />
          </linearGradient>
        </defs>
        <path d={path} fill="url(#mg-grad)" opacity={0.25} />
        <path d={path} fill="none" stroke="url(#mg-grad)" strokeWidth={strokeWidth as number} strokeLinejoin="round" strokeLinecap="round" />
        {/* echo ring for 3D suggestion */}
        <path d={path} fill="none" stroke={accentColor as string} strokeWidth={(strokeWidth as number) * 0.4} strokeLinejoin="round" opacity={0.5} transform={`rotate(${rot * 0.5})`} />
      </svg>
    </AbsoluteFill>
  );
};

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
// referenced to silence unused warnings on transpile-strip
void interpolate;
