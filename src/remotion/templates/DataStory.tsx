import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, Sequence } from 'remotion';

// Full composition: 45s data story
// Sequences: intro(0-180) → stat1(180-570) → stat2(570-960) → outro(960-1350)
const PARAMS = {
  storyTitle: "By the numbers",         // type: text, sequence: intro
  storySubtitle: "2026 in review",      // type: text, sequence: intro
  stat1Value: "2.4M",                   // type: text, sequence: stat-1
  stat1Label: "videos generated",       // type: text, sequence: stat-1
  stat1Insight: "Up 312% year over year", // type: text, sequence: stat-1
  stat2Value: "47s",                    // type: text, sequence: stat-2
  stat2Label: "average creation time",  // type: text, sequence: stat-2
  stat2Insight: "Down from 12 minutes", // type: text, sequence: stat-2
  closingMessage: "And we are just getting started", // type: text, sequence: outro
  primaryColor: "#22d3ee",              // type: color, sequence: global
  accentColor: "#f472b6",               // type: color, sequence: global
  backgroundColor: "#0b1020",           // type: color, sequence: global
  textColor: "#ffffff",                 // type: color, sequence: global
} as const;

export const DataStory = ({
  storyTitle = PARAMS.storyTitle,
  storySubtitle = PARAMS.storySubtitle,
  stat1Value = PARAMS.stat1Value,
  stat1Label = PARAMS.stat1Label,
  stat1Insight = PARAMS.stat1Insight,
  stat2Value = PARAMS.stat2Value,
  stat2Label = PARAMS.stat2Label,
  stat2Insight = PARAMS.stat2Insight,
  closingMessage = PARAMS.closingMessage,
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
      <Sequence from={0} durationInFrames={180} name="intro">
        <dataStoryScenes.Intro title={storyTitle as string} subtitle={storySubtitle as string} {...colors} />
      </Sequence>
      <Sequence from={180} durationInFrames={390} name="stat-1">
        <dataStoryScenes.Stat index={1} value={stat1Value as string} label={stat1Label as string} insight={stat1Insight as string} {...colors} />
      </Sequence>
      <Sequence from={570} durationInFrames={390} name="stat-2">
        <dataStoryScenes.Stat index={2} value={stat2Value as string} label={stat2Label as string} insight={stat2Insight as string} accentFlip {...colors} />
      </Sequence>
      <Sequence from={960} durationInFrames={390} name="outro">
        <dataStoryScenes.Outro message={closingMessage as string} {...colors} />
      </Sequence>
    </AbsoluteFill>
  );
};

const dataStoryScenes = {
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
    const titleIn = spring({ fps, frame, config: { damping: 18, stiffness: 160 } });
    const subIn = spring({ fps, frame: frame - 24, config: { damping: 20, stiffness: 150 } });
    const out = interpolate(frame, [150, 180], [1, 0], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

    return (
      <AbsoluteFill style={{ backgroundColor, opacity: out, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '0 80px' }}>
          <div style={{
            fontSize: 56,
            fontWeight: 600,
            color: accentColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: subIn,
            marginBottom: 30,
          }}>
            {subtitle}
          </div>
          <div style={{
            fontSize: 160,
            fontWeight: 900,
            color: textColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            transform: `translateY(${interpolate(titleIn, [0, 1], [40, 0])}px)`,
            opacity: titleIn,
          }}>
            {title}
          </div>
          <div style={{
            marginTop: 40,
            width: interpolate(titleIn, [0, 1], [0, 280]),
            height: 8,
            background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})`,
            borderRadius: 4,
            margin: '40px auto 0',
          }} />
        </div>
      </AbsoluteFill>
    );
  },

  Stat: ({
    index,
    value,
    label,
    insight,
    accentFlip,
    primaryColor,
    accentColor,
    backgroundColor,
    textColor,
  }: {
    index: number;
    value: string;
    label: string;
    insight: string;
    accentFlip?: boolean;
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
  }) => {
    // section: main
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();
    const valIn = spring({ fps, frame, config: { damping: 14, stiffness: 180, mass: 0.9 } });
    const labelIn = spring({ fps, frame: frame - 20, config: { damping: 18, stiffness: 160 } });
    const insightIn = spring({ fps, frame: frame - 40, config: { damping: 20, stiffness: 150 } });
    const out = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const heroColor = accentFlip ? accentColor : primaryColor;
    const subColor = accentFlip ? primaryColor : accentColor;

    return (
      <AbsoluteFill style={{ backgroundColor, opacity: out }}>
        <div style={{
          position: 'absolute',
          top: 80,
          left: 100,
          fontSize: 32,
          fontWeight: 700,
          color: subColor,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '0.2em',
          opacity: labelIn,
        }}>
          {`STAT ${String(index).padStart(2, '0')}`}
        </div>
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${valIn})`,
          opacity: valIn,
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 360,
            fontWeight: 900,
            color: heroColor,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '-0.05em',
            lineHeight: 1,
            textShadow: `0 0 60px ${heroColor}40`,
          }}>
            {value}
          </div>
          <div style={{
            fontSize: 56,
            fontWeight: 500,
            color: textColor,
            opacity: labelIn * 0.9,
            fontFamily: 'system-ui, sans-serif',
            marginTop: 16,
            letterSpacing: '0.02em',
            transform: `translateY(${interpolate(labelIn, [0, 1], [30, 0])}px)`,
          }}>
            {label}
          </div>
        </div>
        <div style={{
          position: 'absolute',
          bottom: 100,
          left: 100,
          right: 100,
          textAlign: 'center',
          fontSize: 40,
          fontWeight: 600,
          color: subColor,
          fontFamily: 'system-ui, sans-serif',
          opacity: insightIn,
          transform: `translateY(${interpolate(insightIn, [0, 1], [20, 0])}px)`,
        }}>
          {insight}
        </div>
      </AbsoluteFill>
    );
  },

  Outro: ({
    message,
    primaryColor,
    accentColor,
    backgroundColor,
    textColor,
  }: {
    message: string;
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
  }) => {
    // section: outro
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const msgIn = spring({ fps, frame, config: { damping: 18, stiffness: 150 } });
    const words = message.split(' ');

    return (
      <AbsoluteFill style={{ backgroundColor, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.4em', padding: '0 100px', maxWidth: 1500 }}>
          {words.map((word, i) => {
            const delay = i * 6;
            const wIn = spring({ fps, frame: frame - delay, config: { damping: 18, stiffness: 160 } });
            return (
              <span
                key={i}
                style={{
                  fontSize: 92,
                  fontWeight: 800,
                  color: i === words.length - 1 ? accentColor : textColor,
                  fontFamily: 'system-ui, sans-serif',
                  letterSpacing: '-0.02em',
                  opacity: wIn,
                  transform: `translateY(${interpolate(wIn, [0, 1], [40, 0])}px)`,
                  display: 'inline-block',
                  lineHeight: 1.15,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
        <div style={{
          marginTop: 60,
          width: interpolate(msgIn, [0, 1], [0, 320]),
          height: 6,
          background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})`,
          borderRadius: 3,
          opacity: msgIn,
        }} />
      </AbsoluteFill>
    );
  },
};
