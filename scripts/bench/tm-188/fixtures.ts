/**
 * TM-188 — deterministic motion-presence fixtures.
 *
 * These are hand-written generated-code samples used to VERIFY the bench driver
 * classifies motion presence correctly WITHOUT a live model call or a real
 * Remotion render. They feed two channels of the TM-184 liveness gate:
 *
 *   - `staticSource` / `liveSource` are scored by the AST stage
 *     (`detectStaticMotionSource`) — free, deterministic, no Chrome.
 *   - `renderFrames` are synthetic downscaled feature vectors that drive the
 *     Stage-2 render-diff (`checkRenderedLiveness`) through its `__renderStill`
 *     / `__extractFeatures` injection seams, so we can prove the diff logic
 *     classifies "source looks live but rendered frames are identical" as
 *     static — all without booting a renderer.
 *
 * Determinism (ADR-0018): every value here is a literal. No randomness, no
 * model, no real render. Re-running the driver over these fixtures yields the
 * exact same classification every time.
 */

export interface SourceFixture {
  id: string;
  /** Ground-truth label the driver must reproduce. */
  expectStatic: boolean;
  /** Why it's labelled this way (documentation + report). */
  note: string;
  code: string;
}

/**
 * KNOWN-STATIC source fixtures — the AST stage MUST flag every one.
 * These mirror the historical "애니메이션이 안 움직인다" failure class.
 */
export const STATIC_SOURCE_FIXTURES: SourceFixture[] = [
  {
    id: 'static-no-hook',
    expectStatic: true,
    note: 'Never calls useCurrentFrame — pure static poster (locomotion prompt rendered as a single still).',
    code: `
      export const PARAMS = { title: '곰돌이 산책', bg: '#bde' };
      function GeneratedAsset() {
        return (
          <AbsoluteFill style={{ background: PARAMS.bg }}>
            <div style={{ fontSize: 80 }}>🐻</div>
            <h1>{PARAMS.title}</h1>
          </AbsoluteFill>
        );
      }
    `,
  },
  {
    id: 'static-css-keyframes',
    expectStatic: true,
    note: 'Periodic-loader expressed as a CSS @keyframes spin — frozen at t=0 under frame-isolated render (TM-185 axis).',
    code: `
      export const PARAMS = { speed: '1s' };
      function GeneratedAsset() {
        return (
          <AbsoluteFill>
            <style>{\`@keyframes spin { to { transform: rotate(360deg); } }\`}</style>
            <div style={{ animation: 'spin 1s linear infinite' }}>◐</div>
          </AbsoluteFill>
        );
      }
    `,
  },
  {
    id: 'static-css-transition',
    expectStatic: true,
    note: 'Transition prompt rendered as a CSS transition — never advances frame-to-frame.',
    code: `
      export const PARAMS = { x: 200 };
      function GeneratedAsset() {
        return (
          <AbsoluteFill>
            <div style={{ transform: 'translateX(200px)', transition: 'transform 0.5s ease' }}>panel</div>
          </AbsoluteFill>
        );
      }
    `,
  },
  {
    id: 'static-frame-mention-comment',
    expectStatic: true,
    note: 'Mentions useCurrentFrame/interpolate only in a comment + a string label — not a real call.',
    code: `
      export const PARAMS = { label: 'parallax' };
      function GeneratedAsset() {
        // could use useCurrentFrame() here for parallax but the bg is fixed
        const hint = 'interpolate the layers later';
        return <AbsoluteFill><p>{PARAMS.label} {hint}</p></AbsoluteFill>;
      }
    `,
  },
];

/**
 * KNOWN-LIVE source fixtures — the AST stage MUST pass every one (no static
 * reason). These are genuinely frame-driven across the TM-188 motion axes.
 */
export const LIVE_SOURCE_FIXTURES: SourceFixture[] = [
  {
    id: 'live-interpolate-walk',
    expectStatic: false,
    note: 'Locomotion: x position interpolated from the current frame (横스크롤 walk).',
    code: `
      export const PARAMS = { color: '#964B00' };
      function GeneratedAsset() {
        const frame = useCurrentFrame();
        const x = interpolate(frame, [0, 300], [0, 800]);
        return <AbsoluteFill><div style={{ transform: \`translateX(\${x}px)\`, color: PARAMS.color }}>🐻</div></AbsoluteFill>;
      }
    `,
  },
  {
    id: 'live-spring-counter',
    expectStatic: false,
    note: 'Data-viz: spring-driven counter from the current frame.',
    code: `
      export const PARAMS = { target: 100 };
      function GeneratedAsset() {
        const s = spring({ frame: useCurrentFrame(), fps: 30 });
        const value = Math.round(s * PARAMS.target);
        return <AbsoluteFill><h1>{value}</h1></AbsoluteFill>;
      }
    `,
  },
  {
    id: 'live-parallax-layers',
    expectStatic: false,
    note: 'Parallax: two layers interpolated at different rates off the current frame.',
    code: `
      export const PARAMS = { near: '#2a2', far: '#88a' };
      function GeneratedAsset() {
        const frame = useCurrentFrame();
        const near = interpolate(frame, [0, 240], [0, -600]);
        const far = interpolate(frame, [0, 240], [0, -200]);
        return (
          <AbsoluteFill>
            <div style={{ transform: \`translateX(\${far}px)\`, background: PARAMS.far }} />
            <div style={{ transform: \`translateX(\${near}px)\`, background: PARAMS.near }} />
          </AbsoluteFill>
        );
      }
    `,
  },
  {
    id: 'live-interpolate-colors-loader',
    expectStatic: false,
    note: 'Periodic loader: interpolateColors over the current frame.',
    code: `
      export const PARAMS = { a: '#fff', b: '#0af' };
      function GeneratedAsset() {
        const frame = useCurrentFrame();
        const c = interpolateColors(frame % 60, [0, 30, 60], [PARAMS.a, PARAMS.b, PARAMS.a]);
        return <AbsoluteFill><div style={{ background: c }} /></AbsoluteFill>;
      }
    `,
  },
];

/**
 * Synthetic render-diff fixtures for the Stage-2 cross-frame check. Each is a
 * triple of downscaled feature vectors (the shape `__extractFeatures` returns).
 * `expectStatic=true` means the three frames are effectively identical even
 * though the SOURCE referenced a frame hook — the deceptive case the render
 * diff exists to catch (value computed but never bound to a visible property).
 */
export interface RenderFixture {
  id: string;
  expectStatic: boolean;
  note: string;
  /** 0 / mid / last feature vectors (length 1024 to match DOWNSCALE 32×32). */
  frames: number[][];
}

const FLAT = (v: number) => new Array(1024).fill(v);
const MOVED = (base: number, hot: number, n: number) =>
  new Array(1024).fill(base).map((x, i) => (i < n ? hot : x));

export const RENDER_FIXTURES: RenderFixture[] = [
  {
    id: 'render-identical',
    expectStatic: true,
    note: 'Source referenced useCurrentFrame but bound it to nothing visible — three frames identical.',
    frames: [FLAT(100), FLAT(100), FLAT(100)],
  },
  {
    id: 'render-moving',
    expectStatic: false,
    note: 'A bright region moves between frames — genuine motion.',
    frames: [FLAT(100), MOVED(100, 240, 300), FLAT(100)],
  },
  {
    id: 'render-subtle-but-live',
    expectStatic: false,
    note: 'Small but real change across frames (above ε).',
    frames: [FLAT(100), MOVED(100, 160, 400), MOVED(100, 130, 200)],
  },
];
