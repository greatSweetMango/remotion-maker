/**
 * TM-151 — unit tests for the full-pipeline progress copy / curve.
 */
import {
  generationProgress,
  generationProgressMessage,
  generationProgressPercent,
} from '@/lib/generation-progress';

describe('generationProgressMessage — TM-151 step copy', () => {
  it('returns outline copy under 5s', () => {
    expect(generationProgressMessage(0)).toMatch(/구성/);
    expect(generationProgressMessage(4_999)).toMatch(/구성/);
  });

  it('switches to scene/asset copy in 5–20s band', () => {
    expect(generationProgressMessage(5_000)).toMatch(/장면|일러스트/);
    expect(generationProgressMessage(19_999)).toMatch(/장면|일러스트/);
  });

  it('switches to asset-gen long-tail copy in 20–45s band', () => {
    expect(generationProgressMessage(20_000)).toMatch(/마무리|조금만/);
    expect(generationProgressMessage(44_999)).toMatch(/마무리|조금만/);
  });

  it('switches to compose copy in 45–75s band (character p50≈57s)', () => {
    expect(generationProgressMessage(45_000)).toMatch(/코드|거의/);
    expect(generationProgressMessage(74_999)).toMatch(/코드|거의/);
  });

  it('apologizes past 75s (over budget)', () => {
    expect(generationProgressMessage(75_000)).toMatch(/오래|기다려/);
    expect(generationProgressMessage(120_000)).toMatch(/오래|기다려/);
  });

  it('handles negative input without crashing', () => {
    expect(generationProgressMessage(-1)).toMatch(/구성/);
  });
});

describe('generationProgressPercent — logistic curve', () => {
  it('starts at 0', () => {
    expect(generationProgressPercent(0)).toBe(0);
  });

  it('hits roughly 50% near the p50 (~28s — k=40 calibration)', () => {
    const p = generationProgressPercent(28_000);
    expect(p).toBeGreaterThan(45);
    expect(p).toBeLessThan(55);
  });

  it('exceeds 70% by p50_character (57s)', () => {
    expect(generationProgressPercent(57_000)).toBeGreaterThan(70);
  });

  it('caps at 95 — never hits 100', () => {
    expect(generationProgressPercent(60 * 60 * 1000)).toBeLessThanOrEqual(95);
    expect(generationProgressPercent(1_000_000)).toBeLessThan(96);
  });

  it('monotonically non-decreasing across the budget window', () => {
    let prev = -1;
    for (let s = 0; s <= 120; s += 5) {
      const p = generationProgressPercent(s * 1000);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('generationProgress aggregate', () => {
  it('returns both message and percent', () => {
    const r = generationProgress(30_000);
    expect(r.message).toBeTruthy();
    expect(typeof r.percent).toBe('number');
  });
});
