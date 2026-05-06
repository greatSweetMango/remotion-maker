import { composeSceneCodes } from '../../src/lib/ai/pipeline';
import { transpileTSX } from '../../src/lib/remotion/transpiler';

const OUTLINE = {
  title: 'Demo',
  totalDurationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
  palette: { primary: '#7C3AED', secondary: '#A78BFA', accent: '#F472B6', background: '#0f0f17' },
  scenes: [
    { name: 'intro', role: 'title-reveal' as const, durationInFrames: 60, keyElements: [], narrativeBeat: '' },
    { name: 'main', role: 'data-viz' as const, durationInFrames: 90, keyElements: [], narrativeBeat: '' },
  ],
};

const SCENE1 = `const Scene1Params = {
  scene1_color: "#7C3AED",
} as const;
const Scene1 = ({ scene1_color = Scene1Params.scene1_color } = Scene1Params) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 30], [0, 1]);
  return (<AbsoluteFill style={{ opacity: o, backgroundColor: scene1_color }} />);
};`;

const SCENE2_REUSED = `const Scene1Params = {
  scene1_color: "#FF0000",
} as const;
const Scene1 = ({ scene1_color = Scene1Params.scene1_color } = Scene1Params) => {
  const frame = useCurrentFrame();
  return (<AbsoluteFill style={{ backgroundColor: scene1_color }} />);
};`;

const composed = composeSceneCodes(OUTLINE, [SCENE1, SCENE2_REUSED]);
console.log('========== COMPOSED ==========');
console.log(composed);
console.log('========== END ==========');

(async () => {
  try {
    const js = await transpileTSX(composed);
    console.log('========== TRANSPILED JS (head 4000) ==========');
    console.log(js.slice(0, 4000));
  } catch (e) {
    console.log('TRANSPILE ERR:', e instanceof Error ? e.message : e);
  }
})();
