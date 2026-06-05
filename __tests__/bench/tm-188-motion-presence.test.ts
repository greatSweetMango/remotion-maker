/**
 * TM-188 — motion-presence bench driver: deterministic classification tests.
 *
 * Acceptance: the driver's scoring must label every bundled fixture correctly
 * WITHOUT a live model call or a real Remotion render (ADR-0018 determinism).
 *
 *   - known-static source fixtures → verdict 'static' (AST stage).
 *   - known-live source fixtures   → verdict 'live'  (AST passes).
 *   - render-diff fixtures: live-looking source whose rendered frames are
 *     identical → 'static' (render stage); moving frames → 'live'.
 *   - the same input scored twice yields identical results (deterministic).
 *
 * The render-diff path runs entirely through the TM-184 injection seams
 * (__renderStill / __extractFeatures), so JEST_WORKER_ID's render-default-off
 * is respected — no Chrome, no bundle.
 */
import {
  scoreMotion,
  diffToMotionScore,
} from '../../scripts/bench/tm-188/scorer';
import {
  STATIC_SOURCE_FIXTURES,
  LIVE_SOURCE_FIXTURES,
  RENDER_FIXTURES,
} from '../../scripts/bench/tm-188/fixtures';

const LIVE_LOOKING =
  'function GeneratedAsset(){ const f = useCurrentFrame(); return <div data-f={f}/>; }';

describe('TM-188 scoreMotion — known-static source fixtures → static', () => {
  for (const f of STATIC_SOURCE_FIXTURES) {
    it(`flags "${f.id}" as static (AST stage)`, async () => {
      const s = await scoreMotion(f.code);
      expect(s.verdict).toBe('static');
      expect(s.stage).toBe('ast');
      expect(s.motionScore).toBe(0);
      expect(s.astReasonCodes.length).toBeGreaterThan(0);
    });
  }
});

describe('TM-188 scoreMotion — known-live source fixtures → live', () => {
  for (const f of LIVE_SOURCE_FIXTURES) {
    it(`passes "${f.id}" (no AST static reason)`, async () => {
      const s = await scoreMotion(f.code);
      expect(s.verdict).toBe('live');
      expect(s.astReasonCodes).toEqual([]);
    });
  }
});

describe('TM-188 scoreMotion — render-diff fixtures (mock seam, no Chrome)', () => {
  for (const f of RENDER_FIXTURES) {
    it(`classifies "${f.id}" as ${f.expectStatic ? 'static' : 'live'}`, async () => {
      const s = await scoreMotion(LIVE_LOOKING, f.frames);
      expect(s.stage).toBe('render');
      expect(s.verdict).toBe(f.expectStatic ? 'static' : 'live');
      if (f.expectStatic) {
        expect(s.motionScore).toBe(0);
      } else {
        expect(s.motionScore).toBeGreaterThan(0);
      }
    });
  }
});

describe('TM-188 diffToMotionScore — deterministic mapping', () => {
  it('0 diff → 0', () => expect(diffToMotionScore(0)).toBe(0));
  it('saturates at/above 25', () => {
    expect(diffToMotionScore(25)).toBe(100);
    expect(diffToMotionScore(100)).toBe(100);
  });
  it('linear in between', () => expect(diffToMotionScore(12.5)).toBe(50));
});

describe('TM-188 determinism — same input scored twice is identical', () => {
  it('static source', async () => {
    const a = await scoreMotion(STATIC_SOURCE_FIXTURES[0].code);
    const b = await scoreMotion(STATIC_SOURCE_FIXTURES[0].code);
    expect(a).toEqual(b);
  });
  it('render fixture', async () => {
    const moving = RENDER_FIXTURES.find((f) => !f.expectStatic)!;
    const a = await scoreMotion(LIVE_LOOKING, moving.frames);
    const b = await scoreMotion(LIVE_LOOKING, moving.frames);
    expect(a.verdict).toBe(b.verdict);
    expect(a.motionScore).toBe(b.motionScore);
  });
});
