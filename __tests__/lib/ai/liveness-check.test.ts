/**
 * TM-184 — motion-liveness gate unit tests.
 *
 * Two-stage positive liveness check (does the output actually move across
 * frames?). Covers:
 *   - Stage 1 AST pre-filter (`detectStaticMotionSource`):
 *       • 5 static fixtures (no useCurrentFrame / translateX-only-static-bg /
 *         CSS-only animation) all flagged.
 *       • All 35 production templates pass (false-positive = 0).
 *       • comment/string mentions of useCurrentFrame don't count as live.
 *   - Stage 2 rendered cross-frame diff (`checkRenderedLiveness`):
 *       • identical frames → 'static'; differing frames → 'live'.
 *       • renderStill throws → 'skipped' (never blocks).
 *       • frame selection 0/mid/last; ε honored.
 *   - Combined `evaluateLiveness`: AST short-circuits render; render verdict.
 *   - Env gating.
 */
import {
  detectStaticMotionSource,
  checkRenderedLiveness,
  evaluateLiveness,
  pickRepresentativeFrames,
  isLivenessGateEnabled,
  isLivenessRenderEnabled,
} from '@/lib/ai/liveness-check';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Fixtures — 5 representative STATIC compositions (acceptance: all FAIL)
// ---------------------------------------------------------------------------

const STATIC_FIXTURES: Record<string, string> = {
  // 1. No useCurrentFrame at all — pure static poster.
  'no-frame-hook': `
    export const PARAMS = { title: 'Hi', bg: '#000' };
    function GeneratedAsset() {
      return (
        <AbsoluteFill style={{ background: PARAMS.bg }}>
          <h1 style={{ color: 'white' }}>{PARAMS.title}</h1>
        </AbsoluteFill>
      );
    }
  `,
  // 2. Static even though it imports remotion — never calls the hook.
  'static-svg': `
    export const PARAMS = { color: '#f00' };
    function GeneratedAsset() {
      return (
        <AbsoluteFill>
          <svg><circle cx={50} cy={50} r={20} fill={PARAMS.color} /></svg>
        </AbsoluteFill>
      );
    }
  `,
  // 3. CSS @keyframes-only "animation" — frozen at t=0 under frame render.
  'css-keyframes-only': `
    export const PARAMS = { speed: '2s' };
    function GeneratedAsset() {
      return (
        <AbsoluteFill>
          <style>{\`@keyframes spin { to { transform: rotate(360deg); } }\`}</style>
          <div style={{ animation: 'spin 2s linear infinite' }}>spinner</div>
        </AbsoluteFill>
      );
    }
  `,
  // 4. CSS transition-only — also frozen at t=0.
  'css-transition-only': `
    export const PARAMS = { x: 100 };
    function GeneratedAsset() {
      return (
        <AbsoluteFill>
          <div style={{ transform: 'translateX(100px)', transition: 'transform 0.5s ease' }}>box</div>
        </AbsoluteFill>
      );
    }
  `,
  // 5. Mentions useCurrentFrame ONLY in a comment / string — not a real call.
  'frame-in-comment-only': `
    export const PARAMS = { label: 'static' };
    function GeneratedAsset() {
      // we could use useCurrentFrame() here but we don't
      const note = 'interpolate and spring are great';
      return (
        <AbsoluteFill>
          <p>{PARAMS.label} {note}</p>
        </AbsoluteFill>
      );
    }
  `,
};

// A genuinely frame-driven composition (acceptance: must PASS the AST stage).
const LIVE_FIXTURE = `
  export const PARAMS = { color: '#0ff' };
  function GeneratedAsset() {
    const frame = useCurrentFrame();
    const opacity = interpolate(frame, [0, 30], [0, 1]);
    return (
      <AbsoluteFill style={{ opacity }}>
        <h1 style={{ color: PARAMS.color }}>Fade</h1>
      </AbsoluteFill>
    );
  }
`;

describe('TM-184 detectStaticMotionSource — static fixtures FAIL', () => {
  for (const [name, code] of Object.entries(STATIC_FIXTURES)) {
    it(`flags "${name}" as static`, () => {
      const reasons = detectStaticMotionSource(code);
      expect(reasons.length).toBeGreaterThan(0);
    });
  }

  it('passes a genuinely frame-driven composition (no false positive)', () => {
    expect(detectStaticMotionSource(LIVE_FIXTURE)).toEqual([]);
  });

  it('a spring-driven scene passes', () => {
    const code = `function GeneratedAsset(){ const s = spring({ frame: useCurrentFrame(), fps: 30 }); return <div style={{ scale: s }}/>; }`;
    expect(detectStaticMotionSource(code)).toEqual([]);
  });

  it('emits no-frame-driven-ref code for the bare static fixture', () => {
    const reasons = detectStaticMotionSource(STATIC_FIXTURES['no-frame-hook']);
    expect(reasons.some((r) => r.code === 'no-frame-driven-ref')).toBe(true);
  });

  it('emits css-freeze code (via TM-185 reuse) for CSS-only animation', () => {
    const reasons = detectStaticMotionSource(STATIC_FIXTURES['css-keyframes-only']);
    expect(reasons.some((r) => r.code === 'css-freeze')).toBe(true);
  });
});

describe('TM-184 detectStaticMotionSource — 35 production templates PASS (FP=0)', () => {
  const dir = path.resolve(process.cwd(), 'src/remotion/templates');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  it('finds the full 35-template corpus', () => {
    expect(files.length).toBe(35);
  });

  for (const f of files) {
    it(`${f} is NOT flagged static`, () => {
      const code = readFileSync(path.join(dir, f), 'utf8');
      expect(detectStaticMotionSource(code)).toEqual([]);
    });
  }
});

describe('TM-184 pickRepresentativeFrames', () => {
  it('returns 0 / mid / last for a normal duration', () => {
    expect(pickRepresentativeFrames(150)).toEqual([0, 75, 149]);
  });
  it('dedupes for tiny durations', () => {
    expect(pickRepresentativeFrames(1)).toEqual([0]);
    expect(pickRepresentativeFrames(2)).toEqual([0, 1]);
  });
});

// Synthetic feature vectors so the render stage runs without Chrome.
const FLAT_A = new Array(1024).fill(100);
const FLAT_B = new Array(1024).fill(100); // identical → static
const MOVED = new Array(1024).fill(100).map((v, i) => (i < 200 ? 240 : v)); // big change

function fakePng(tag: string): Buffer {
  return Buffer.from(tag);
}

describe('TM-184 checkRenderedLiveness — cross-frame diff', () => {
  const base = {
    jsCode: 'function GeneratedAsset(){return null;}',
    params: {},
    durationInFrames: 150,
    bundlePath: '/tmp/fake-bundle',
  };

  it('identical frames → static', async () => {
    const r = await checkRenderedLiveness({
      ...base,
      __renderStill: async ({ frame }) => fakePng(`f${frame}`),
      __extractFeatures: async () => FLAT_A,
    });
    expect(r.verdict).toBe('static');
    expect(r.maxDiff).toBeLessThan(r.epsilon);
  });

  it('differing frames → live', async () => {
    const byFrame: Record<number, number[]> = {};
    const frames = pickRepresentativeFrames(150);
    byFrame[frames[0]] = FLAT_A;
    byFrame[frames[1]] = MOVED;
    byFrame[frames[2]] = FLAT_B;
    let call = 0;
    const order = [...frames];
    const r = await checkRenderedLiveness({
      ...base,
      __renderStill: async () => fakePng(`f${order[call++]}`),
      __extractFeatures: async (png) => {
        const tag = Number(png.toString().replace('f', ''));
        return byFrame[tag] ?? FLAT_A;
      },
    });
    expect(r.verdict).toBe('live');
    expect(r.maxDiff).toBeGreaterThan(r.epsilon);
  });

  it('renderStill throws → skipped (never blocks)', async () => {
    const r = await checkRenderedLiveness({
      ...base,
      __renderStill: async () => {
        throw new Error('chrome missing');
      },
      __extractFeatures: async () => FLAT_A,
    });
    expect(r.verdict).toBe('skipped');
  });

  it('feature extraction throws → skipped', async () => {
    const r = await checkRenderedLiveness({
      ...base,
      __renderStill: async () => fakePng('x'),
      __extractFeatures: async () => {
        throw new Error('decode failed');
      },
    });
    expect(r.verdict).toBe('skipped');
  });

  it('honors a custom epsilon', async () => {
    const slightlyDifferent = FLAT_A.map((v, i) => (i === 0 ? v + 1 : v));
    let call = 0;
    const feats = [FLAT_A, slightlyDifferent, FLAT_A];
    const r = await checkRenderedLiveness({
      ...base,
      epsilon: 0.0001, // ultra-sensitive → tiny diff counts as live
      __renderStill: async () => fakePng('x'),
      __extractFeatures: async () => feats[call++] ?? FLAT_A,
    });
    expect(r.verdict).toBe('live');
  });

  it('samples 0/mid/last frames', async () => {
    const seen: number[] = [];
    await checkRenderedLiveness({
      ...base,
      __renderStill: async ({ frame }) => {
        seen.push(frame);
        return fakePng('x');
      },
      __extractFeatures: async () => FLAT_A,
    });
    expect(seen).toEqual([0, 75, 149]);
  });
});

describe('TM-184 evaluateLiveness — combined', () => {
  // These exercise the render diff with a MOCKED __renderStill, so opt the
  // render stage back in (it defaults off under the jest runner — see env
  // gating tests above). The mock keeps it cheap; no real Remotion render.
  const origRender = process.env.AI_LIVENESS_GATE_RENDER;
  beforeEach(() => {
    process.env.AI_LIVENESS_GATE_RENDER = '1';
  });
  afterEach(() => {
    if (origRender === undefined) delete process.env.AI_LIVENESS_GATE_RENDER;
    else process.env.AI_LIVENESS_GATE_RENDER = origRender;
  });

  it('AST stage short-circuits the render (no render call for static source)', async () => {
    let rendered = false;
    const v = await evaluateLiveness(STATIC_FIXTURES['no-frame-hook'], {
      jsCode: 'x',
      params: {},
      durationInFrames: 150,
      bundlePath: '/tmp/b',
      __renderStill: async () => {
        rendered = true;
        return Buffer.from('x');
      },
    });
    expect(v.isStatic).toBe(true);
    expect(v.stage).toBe('ast');
    expect(rendered).toBe(false);
  });

  it('live source → render stage runs; identical frames → static verdict', async () => {
    const v = await evaluateLiveness(LIVE_FIXTURE, {
      jsCode: 'x',
      params: {},
      durationInFrames: 150,
      bundlePath: '/tmp/b',
      __renderStill: async () => Buffer.from('x'),
      __extractFeatures: async () => FLAT_A,
    });
    expect(v.stage).toBe('render');
    expect(v.isStatic).toBe(true);
    expect(v.reasonCodes).toContain('rendered-frames-identical');
  });

  it('live source + moving frames → not static', async () => {
    let call = 0;
    const feats = [FLAT_A, MOVED, FLAT_A];
    const v = await evaluateLiveness(LIVE_FIXTURE, {
      jsCode: 'x',
      params: {},
      durationInFrames: 150,
      bundlePath: '/tmp/b',
      __renderStill: async () => Buffer.from('x'),
      __extractFeatures: async () => feats[call++] ?? FLAT_A,
    });
    expect(v.isStatic).toBe(false);
    expect(v.render?.verdict).toBe('live');
  });

  it('AST-only mode when no render input provided', async () => {
    const v = await evaluateLiveness(LIVE_FIXTURE);
    expect(v.stage).toBe('none');
    expect(v.isStatic).toBe(false);
  });
});

describe('TM-184 env gating', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env.AI_LIVENESS_GATE = orig.AI_LIVENESS_GATE;
    process.env.AI_LIVENESS_GATE_RENDER = orig.AI_LIVENESS_GATE_RENDER;
  });

  it('gate defaults ON', () => {
    delete process.env.AI_LIVENESS_GATE;
    expect(isLivenessGateEnabled()).toBe(true);
  });
  it('AI_LIVENESS_GATE=0 disables', () => {
    process.env.AI_LIVENESS_GATE = '0';
    expect(isLivenessGateEnabled()).toBe(false);
    expect(isLivenessRenderEnabled()).toBe(false);
  });
  it('render stage: explicit override wins (=1 forces on, =0 forces off)', () => {
    delete process.env.AI_LIVENESS_GATE;
    process.env.AI_LIVENESS_GATE_RENDER = '1';
    expect(isLivenessRenderEnabled()).toBe(true);
    process.env.AI_LIVENESS_GATE_RENDER = '0';
    expect(isLivenessRenderEnabled()).toBe(false);
    expect(isLivenessGateEnabled()).toBe(true); // AST stage still on
  });
  it('render stage defaults OFF under the jest test runner (no real renders)', () => {
    delete process.env.AI_LIVENESS_GATE;
    delete process.env.AI_LIVENESS_GATE_RENDER;
    // JEST_WORKER_ID is set by the runner → render diff defaults off so unit
    // suites never trigger a heavy Remotion render. AST stage stays on.
    expect(isLivenessRenderEnabled()).toBe(false);
    expect(isLivenessGateEnabled()).toBe(true);
  });
  it('render stage defaults ON in a production (non-test) runtime', () => {
    delete process.env.AI_LIVENESS_GATE;
    delete process.env.AI_LIVENESS_GATE_RENDER;
    const origNode = process.env.NODE_ENV;
    const origWorker = process.env.JEST_WORKER_ID;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;
    try {
      expect(isLivenessRenderEnabled()).toBe(true);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origNode;
      if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
    }
  });
});
