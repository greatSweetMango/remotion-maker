import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  events: "Founded,Series A,Launch,1M users,IPO",                                                                          // type: text
  dates: "2019,2020,2021,2023,2025",                                                                                       // type: text
  title: "Company Milestones",                                                                                             // type: text
  primaryColor: "#7C3AED",                                                                                                 // type: color
  accentColor: "#22d3ee",                                                                                                  // type: color
  backgroundColor: "#0a0a14",                                                                                              // type: color
  textColor: "#ffffff",                                                                                                    // type: color
} as const;

export const Timeline = ({
  events = PARAMS.events,
  dates = PARAMS.dates,
  title = PARAMS.title,
  primaryColor = PARAMS.primaryColor,
  accentColor = PARAMS.accentColor,
  backgroundColor = PARAMS.backgroundColor,
  textColor = PARAMS.textColor,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const eventList = String(events).split(',').map(s => s.trim());
  const dateList = String(dates).split(',').map(s => s.trim());
  const n = eventList.length;

  const titleOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const lineProgress = spring({ fps, frame: frame - 6, config: { damping: 30, stiffness: 60 } });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 100px', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        color: textColor as string, fontSize: 56, fontWeight: 700,
        marginBottom: 80, opacity: titleOpacity,
      }}>{title}</div>

      <div style={{ position: 'relative', width: '100%', height: 320 }}>
        <div style={{
          position: 'absolute', top: 160, left: 0,
          height: 6, width: `${100 * lineProgress}%`,
          background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})`,
          borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute', top: 160, left: 0, right: 0,
          height: 6, backgroundColor: 'rgba(255,255,255,0.08)', zIndex: -1,
          borderRadius: 3,
        }} />
        {eventList.map((ev, i) => {
          const left = (i / Math.max(n - 1, 1)) * 100;
          const startFrame = 12 + i * 8;
          const dotScale = spring({ fps, frame: frame - startFrame, config: { damping: 14, stiffness: 200 } });
          const labelFade = interpolate(frame, [startFrame, startFrame + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={i} style={{ position: 'absolute', left: `${left}%`, top: 0, transform: 'translateX(-50%)', textAlign: 'center', width: 200 }}>
              <div style={{
                color: accentColor as string, fontSize: 24, fontWeight: 700,
                marginBottom: 80, opacity: labelFade,
              }}>{dateList[i] || ''}</div>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                backgroundColor: primaryColor as string,
                margin: '0 auto', transform: `scale(${dotScale})`,
                boxShadow: `0 0 20px ${primaryColor}`,
                border: `4px solid ${backgroundColor}`,
              }} />
              <div style={{
                color: textColor as string, fontSize: 24, fontWeight: 600,
                marginTop: 24, opacity: labelFade,
              }}>{ev}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
