/**
 * TM-160 — unit tests for the server-stage → user copy / percent mapping.
 *
 * Acceptance: known stage names produce the expected Korean copy and a
 * percent within the anchored band; unknown stages fall back to the
 * timer curve (TM-91) plus a small "we got something" nudge.
 */
import { stageProgress, generationProgress } from '@/lib/generation-progress';

describe('stageProgress — TM-160 server-stage mapping', () => {
  it('maps pipeline.outline to outline copy + ~15%', () => {
    const s = stageProgress('pipeline.outline', 1_000);
    expect(s.message).toMatch(/구성/);
    expect(s.percent).toBe(15);
  });

  it('maps pipeline.scene-code to scene-code copy + ~80%', () => {
    const s = stageProgress('pipeline.scene-code', 30_000);
    expect(s.message).toMatch(/장면 코드/);
    expect(s.percent).toBe(80);
  });

  it('maps asset-gen wire stages to the long-wait copy + ~60%', () => {
    const s = stageProgress('asset-gen.wire', 20_000);
    expect(s.message).toMatch(/일러스트/);
    expect(s.percent).toBe(60);
  });

  it('maps pipeline.compose+validate to compose copy + ~90%', () => {
    const s = stageProgress('pipeline.compose+validate', 50_000);
    expect(s.message).toMatch(/합치|검증/);
    expect(s.percent).toBe(90);
  });

  it('maps done sentinel to 95% (never claims completion)', () => {
    const s = stageProgress('done', 60_000);
    expect(s.percent).toBe(95);
  });

  it('falls back to timer-based copy for unknown stages (with nudge)', () => {
    const elapsed = 30_000;
    const fallback = generationProgress(elapsed);
    const s = stageProgress('unknown.stage.name', elapsed);
    expect(s.message).toBe(fallback.message);
    expect(s.percent).toBeGreaterThanOrEqual(fallback.percent);
    expect(s.percent).toBeLessThanOrEqual(95);
  });
});
