/**
 * TM-91 — image-gen progressive UX helpers.
 *
 * Pure-function tests for progressMessage / progressPercent. Stable copy
 * and monotonic progress curve are load-bearing for the latency UX, so a
 * tiny regression guard belongs in CI. Component-level render of the
 * Regenerate dialog is already covered by parameter-control-a11y.test.
 */
import { progressMessage, progressPercent } from '@/components/studio/ParameterControl';

describe('TM-91 progressMessage step thresholds', () => {
  it('shows the early reassurance copy under 5s', () => {
    expect(progressMessage(0)).toMatch(/이미지 생성 중/);
    expect(progressMessage(4_999)).toMatch(/이미지 생성 중/);
  });

  it('crosses to the >5s drawing copy at 5s', () => {
    expect(progressMessage(5_000)).toMatch(/AI가 그리는 중/);
  });

  it('crosses to the >15s high-quality copy', () => {
    expect(progressMessage(15_000)).toMatch(/고품질 렌더/);
  });

  it('crosses to the >30s finishing copy', () => {
    expect(progressMessage(30_000)).toMatch(/마무리/);
    expect(progressMessage(60_000)).toMatch(/마무리/);
  });
});

describe('TM-91 progressPercent curve', () => {
  it('starts at 0 and stays in [0,95]', () => {
    expect(progressPercent(0)).toBe(0);
    for (let s = 0; s < 300; s += 1) {
      const v = progressPercent(s * 1000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(95);
    }
  });

  it('is monotonically non-decreasing', () => {
    let prev = -1;
    for (let s = 0; s < 120; s += 1) {
      const v = progressPercent(s * 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('asymptotes near (but never reaches) 100', () => {
    expect(progressPercent(10 * 60 * 1000)).toBe(95);
  });

  it('is roughly half-way around the p50 (38s) per TM-84 bench', () => {
    const v = progressPercent(38_000);
    // 1 - e^(-38/28) ≈ 0.744 → 74.4% — sanity range
    expect(v).toBeGreaterThan(60);
    expect(v).toBeLessThan(90);
  });
});
