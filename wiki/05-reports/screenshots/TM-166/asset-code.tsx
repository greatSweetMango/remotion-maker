const Scene1Params = {
  scene0_primaryColor: "#7C3AED", // type: color
  scene0_breezeIntensity: 1 // type: range
};

const Scene1 = ({
  scene0_primaryColor = Scene1Params.scene0_primaryColor,
  scene0_breezeIntensity = Scene1Params.scene0_breezeIntensity
}) => {
  const frame = useCurrentFrame();
  const bearProgress = spring({
    frame,
    fps: 30,
    config: { damping: 10, mass: 1, stiffness: 80 }
  });
  const bearX = interpolate(bearProgress, [0, 1], [-200, 300], {
    easing: Easing.out(Easing.cubic)
  });
  const bearOpacity = interpolate(bearProgress, [0, 1], [0, 1]);

  const flowerProgress = spring({
    frame: frame - 60,
    fps: 30,
    config: { damping: 8, mass: 1, stiffness: 70 }
  });
  const flowerScale = interpolate(flowerProgress, [0, 1], [0.8, 1]);
  const flowerOpacity = interpolate(flowerProgress, [0, 1], [0, 1]);
  const sway = Math.sin(frame / 10) * 5 * scene0_breezeIntensity;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f17" }}>
      <Img
        src={"/uploads/asset-gen/49067ee01e2cb2ff3a05464d9530b4ba96449a54a316e82b5ee10e2cc8fc150f.png"}
        style={{
          position: "absolute",
          left: bearX,
          top: 340, // Adjusted to ensure bear is visible
          opacity: bearOpacity,
          transform: `scale(1)`
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 800,
          width: "100%",
          height: "200px",
          backgroundColor: scene0_primaryColor
        }}
      />
      {[400, 600, 800].map((x, i) => (
        <lucide.Flower
          key={i}
          style={{
            position: "absolute",
            left: x + sway,
            top: [820, 830, 810][i],
            transform: `scale(${flowerScale})`,
            opacity: flowerOpacity,
            color: "#F472B6"
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

const Scene2Params = {
  scene1_primaryColor: "#7C3AED", // type: color
  scene1_flowerSwaySpeed: 1, // type: range, min: 0.5, max: 2
  scene1_sunlightOpacity: 0.5 // type: range, min: 0.3, max: 1
};

const Scene2 = ({
  scene1_primaryColor = Scene2Params.scene1_primaryColor,
  scene1_flowerSwaySpeed = Scene2Params.scene1_flowerSwaySpeed,
  scene1_sunlightOpacity = Scene2Params.scene1_sunlightOpacity
}) => {
  const frame = useCurrentFrame();
  const bearX = spring({
    frame,
    from: -200,
    to: 1920,
    damping: 10,
    mass: 1,
    stiffness: 80
  });
  const flowerScale = interpolate(frame, [0, 75], [1, 1.05], {
    easing: Easing.out(Easing.cubic)
  });
  const sunlightOpacity = interpolate(frame, [0, 75], [scene1_sunlightOpacity, 0.7], {
    easing: Easing.out(Easing.cubic)
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f17" }}>
      <Img src={imageUrl} style={{ position: 'absolute', left: bearX, top: 340, width: 200, height: 200, objectFit: 'contain' }} />
      <div style={{ position: 'absolute', left: 0, top: 800, width: '100%', height: 200, backgroundColor: scene1_primaryColor }} />
      <lucide.Flowers style={{ position: 'absolute', left: 0, top: 800, transform: `scale(${flowerScale})`, opacity: 1 }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: '#F472B6', opacity: sunlightOpacity }} />
    </AbsoluteFill>
  );
};

class __SceneBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errored: false };
  }
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch(error, info) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[TM-116] scene render error in ' + (this.props.name || 'scene') + ':', error && error.message);
    }
  }
  render() {
    if (this.state.errored) {
      return <AbsoluteFill style={{ backgroundColor: 'transparent' }} />;
    }
    return this.props.children;
  }
}

const PARAMS = {
  imageUrl: "/uploads/asset-gen/49067ee01e2cb2ff3a05464d9530b4ba96449a54a316e82b5ee10e2cc8fc150f.png", // type: text
  ...Scene1Params,
  ...Scene2Params,
} as const;

const GeneratedAsset = (_props: typeof PARAMS = PARAMS) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f17" }}>
      <Sequence from={0} durationInFrames={150}><__SceneBoundary name="Scene1"><Scene1 /></__SceneBoundary></Sequence>
      <Sequence from={150} durationInFrames={150}><__SceneBoundary name="Scene2"><Scene2 /></__SceneBoundary></Sequence>
    </AbsoluteFill>
  );
};
GeneratedAsset.displayName = 'GeneratedAsset';

