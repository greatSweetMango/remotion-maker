import { useCurrentFrame, AbsoluteFill } from 'remotion';

const PARAMS = {
  text: "Hello, World!",       // type: text
  textColor: "#ffffff",        // type: color
  cursorColor: "#7C3AED",     // type: color
  backgroundColor: "#0f0f17", // type: color
  fontSize: 72,               // type: range, min: 20, max: 160, unit: px
  speed: 4,                   // type: range, min: 1, max: 15
} as const;

export const Typewriter = ({
  text = PARAMS.text,
  textColor = PARAMS.textColor,
  cursorColor = PARAMS.cursorColor,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  speed = PARAMS.speed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const str = text as string;
  const charsToShow = Math.min(Math.floor(frame / (30 / (speed as number))), str.length);
  const displayText = str.slice(0, charsToShow);
  const cursorVisible = Math.floor(frame / 14) % 2 === 0;

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', maxWidth: '80%', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: fontSize as number,
          fontWeight: 700,
          fontFamily: '"Courier New", Courier, monospace',
          color: textColor as string,
          lineHeight: 1.3,
          wordBreak: 'break-word',
        }}>
          {displayText}
        </span>
        <span style={{
          display: 'inline-block',
          width: Math.max(3, (fontSize as number) * 0.05),
          height: (fontSize as number) * 1.1,
          backgroundColor: cursorVisible ? cursorColor as string : 'transparent',
          marginLeft: 4,
          borderRadius: 2,
          verticalAlign: 'middle',
          flexShrink: 0,
        }} />
      </div>
    </AbsoluteFill>
  );
};
