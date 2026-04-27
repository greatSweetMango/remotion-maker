import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, Sequence } from 'remotion';

// Full composition: 30s highlight reel
// Sequences: intro(0-150) → h1(150-360) → h2(360-570) → h3(570-780) → outro(780-900)
const PARAMS = {
  reelTitle: "Best of 2026",          // type: text
  reelSubtitle: "Top moments",        // type: text
  highlight1: "Launched in 12 countries", // type: text
  highlight2: "1M+ creators onboarded",   // type: text
  highlight3: "Featured by Apple",        // type: text
  outroText: "More to come",          // type: text
  primaryColor: "#fb7185",            // type: color
  accentColor: "#fbbf24",             // type: color
  backgroundColor: "#0c0a1a",         // type: color
  textColor: "#ffffff",               // type: color
} as const;

export const HighlightReel = ({
  reelTitle = PARAMS.reelTitle,
  reelSubtitle = PARAMS.reelSubtitle,
  highlight1 = PARAMS.highlight1,
  highlight2 = PARAMS.highlight2,
  highlight3 = PARAMS.highlight3,
  outroText = PARAMS.outroText,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
}: typeof PARAMS = PARAMS) => {
  const colors = {
    primaryColor: primaryColor as string,
    accentColor: accentColor as string,
    backgroundColor: backgroundColor as string,
    textColor: textColor as string,
  };
  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string }}>
      <Sequence from={0} durationInFrames={150} name="intro">
        <highlightReelScenes.Intro title={reelTitle as string} subtitle={reelSubtitle as string} {...colors} />
      </Sequence>
      <Sequence from={150} durationInFrames={210} name="highlight-1">
        <highlightReelScenes.Highlight index={1} text={highlight1 as string} {...colors} />
      </Sequence>
      <Sequence from={360} durationInFrames={210} name="highlight-2">
        <highlightReelScenes.Highlight index={2} text={highlight2 as string} {...colors} />
      </Sequence>
      <Sequence from={570} durationInFrames={210} name="highlight-3">
        <highlightReelScenes.Highlight index={3} text={highlight3 as string} {...colors} />
      </Sequence>
      <Sequence from={780} durationInFrames={120} name="outro">
        <highlightReelScenes.Outro text={outroText as string} {...colors} />
      </Sequence>
    </AbsoluteFill>
  );
};

const highlightReelScenes = {
  Intro: ({
    title,
    subtitle,
    primaryColor,
    accentColor,
    backgroundColor,
    textColor,
  }: {
    title: string;
    subtitle: string;
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
  }) => {
    // section: intro
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const titleIn = spring({ fps, frame, config: { damping: 12, stiffness: 200 } });
    const subIn = spring({ fps, frame: frame - 18, config: { damping: 16, stiffness: 180 } });
    const out = interpolate(frame, [120, 150], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const flash = interpolate(frame, [0, 6, 12], [0.95, 0.4, 0], { extrapolateRight: 'clamp' });

    return (
      <AbsoluteFill style={{ backgroundColor, opacity: out, alignItems: 'center', justifyContent: 'center' }}>
        <AbsoluteFill style={{ backgroundColor: primaryColor, opacity: flash }} />
        <div style={{ textAlign: 'center', transform: `scale(${titleIn})`, opacity: titleIn }}>
          <div style={{
            fontSize: 220,
            fontWeight: 900,
            color: textColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '-0.05em',
            lineHeight: 1,
            textShadow: `8px 8px 0 ${primaryColor}`,
          }}>
            {title}
          </div>
          <div style={{
            fontSize: 56,
            fontWeight: 700,
            color: accentColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            marginTop: 24,
            opacity: subIn,
            transform: `translateY(${interpolate(subIn, [0, 1], [20, 0])}px)`,
          }}>
            {subtitle}
          </div>
        </div>
      </AbsoluteFill>
    );
  },

  Highlight: ({
    index,
    text,
    primaryColor,
    accentColor,
    backgroundColor,
    textColor,
  }: {
    index: number;
    text: string;
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
  }) => {
    // section: main
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();
    const numIn = spring({ fps, frame, config: { damping: 12, stiffness: 220 } });
    const textIn = spring({ fps, frame: frame - 12, config: { damping: 16, stiffness: 180 } });
    const out = interpolate(frame, [durationInFrames - 24, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const stripeOffset = interpolate(frame, [0, durationInFrames], [0, -200]);
    const accents = [primaryColor, accentColor, primaryColor];
    const heroColor = accents[(index - 1) % accents.length];

    return (
      <AbsoluteFill style={{ backgroundColor, opacity: out, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `repeating-linear-gradient(45deg, transparent 0 60px, ${heroColor}15 60px 120px)`,
          transform: `translateX(${stripeOffset}px)`,
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%)`,
          textAlign: 'center',
          padding: '0 80px',
        }}>
          <div style={{
            fontSize: 240,
            fontWeight: 900,
            color: heroColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '-0.05em',
            lineHeight: 1,
            transform: `scale(${numIn})`,
            opacity: numIn,
          }}>
            {`#${index}`}
          </div>
          <div style={{
            fontSize: 80,
            fontWeight: 800,
            color: textColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginTop: 24,
            maxWidth: 1500,
            opacity: textIn,
            transform: `translateY(${interpolate(textIn, [0, 1], [40, 0])}px)`,
          }}>
            {text}
          </div>
        </div>
      </AbsoluteFill>
    );
  },

  Outro: ({
    text,
    primaryColor,
    accentColor,
    backgroundColor,
    textColor,
  }: {
    text: string;
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
  }) => {
    // section: outro
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const textIn = spring({ fps, frame, config: { damping: 14, stiffness: 200 } });

    return (
      <AbsoluteFill style={{ backgroundColor, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontSize: 140,
          fontWeight: 900,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '-0.04em',
          background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: textColor,
          transform: `scale(${textIn})`,
          opacity: textIn,
          textAlign: 'center',
          padding: '0 80px',
        }}>
          {text}
        </div>
      </AbsoluteFill>
    );
  },
};
