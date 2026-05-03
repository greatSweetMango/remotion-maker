/**
 * TM-74 — Reference template retrieval (RAG, simple).
 *
 * Verifies:
 *   1. Category inference is accurate for the well-formed prompts we see in
 *      production (chart / transition / counter / text / background) AND
 *      bilingual (KO + EN).
 *   2. Picker chooses the right template within a category via keyword tiebreak.
 *   3. The composed reference block is non-empty for hits and empty for misses.
 */

import {
  inferCategoryFromPrompt,
  pickReferenceTemplate,
  buildReferenceBlock,
  retrieveReferenceForPrompt,
  REFERENCE_CATALOG,
} from '@/lib/ai/retrieval';

describe('retrieval — category inference', () => {
  const cases: Array<[string, ReturnType<typeof inferCategoryFromPrompt>]> = [
    // chart / data-viz
    ['Bar chart with sales data 120, 150, 180', 'chart'],
    ['도넛 차트 60% 40% 보여줘', 'chart'],
    ['주식 시세 라인 그래프', 'chart'],
    // "KPI" is also matched by the chart regex; chart category fires first.
    // Both chart and counter are reasonable references for a KPI prompt, so
    // we lock in the current "chart-first" behavior as the contract.
    ['실시간 KPI 카운터', 'chart'],
    // transition
    ['Slide transition from left to right, two colored panels', 'transition'],
    ['페이드 인 페이드 아웃, 검정에서 흰색으로 1.5초', 'transition'],
    ['zoom in punch effect for scene cut', 'transition'],
    // counter
    ['Animated counter from 0 to 100 with spring', 'counter'],
    ['카운트다운 3초', 'counter'],
    // text-anim
    ['Typewriter "Hello World" with monospace', 'text'],
    ['글리치 효과 텍스트, RGB-split', 'text'],
    // background / loop
    ['Loopable particle background, atmospheric', 'background'],
    ['추상 그라디언트 배경 루프', 'background'],
    // logo
    ['Logo reveal intro, ring stroke + brand fade', 'logo'],
    ['로고 인트로', 'logo'],
    // infographic
    ['Timeline of milestones, horizontal', 'infographic'],
    // composition
    ['60s product intro showcase', 'composition'],
    // miss — pure abstract phrase with no category signal
    ['something cool', null],
    ['뭐 좀 멋진거', null],
  ];

  test.each(cases)('infers correctly: "%s"', (prompt, expected) => {
    expect(inferCategoryFromPrompt(prompt)).toBe(expected);
  });
});

describe('retrieval — picker', () => {
  it('picks BarChart for "bar" prompts', () => {
    const ref = pickReferenceTemplate('chart', 'animated bar chart with sales');
    expect(ref?.id).toBe('bar-chart');
  });

  it('picks DonutChart for "donut/pie/percentage" prompts', () => {
    const ref = pickReferenceTemplate('chart', '도넛 차트 60% 40%');
    expect(ref?.id).toBe('donut-chart');
  });

  it('picks LineChart for stock / trend prompts', () => {
    const ref = pickReferenceTemplate('chart', '주식 시세 line trend');
    expect(ref?.id).toBe('line-chart');
  });

  it('picks Typewriter for typing prompts', () => {
    const ref = pickReferenceTemplate('text', 'typewriter hello world');
    expect(ref?.id).toBe('typewriter');
  });

  it('picks Glitch for glitch / RGB-split prompts', () => {
    const ref = pickReferenceTemplate('text', 'glitch text rgb split');
    expect(ref?.id).toBe('glitch-effect');
  });

  it('falls back to first entry when no keyword matches', () => {
    const ref = pickReferenceTemplate('chart', 'graph');
    // first chart entry registered is bar-chart
    expect(ref?.id).toBe('bar-chart');
  });

  it('returns null when category has no entries', () => {
    const ref = pickReferenceTemplate(
      'chart',
      'foo',
      REFERENCE_CATALOG.filter(t => t.category !== 'chart'),
    );
    expect(ref).toBeNull();
  });
});

describe('retrieval — reference block composition', () => {
  it('returns empty string when category cannot be inferred', () => {
    const block = buildReferenceBlock('something cool');
    expect(block).toBe('');
  });

  it('returns empty string when source loader returns null', () => {
    const block = buildReferenceBlock('bar chart 120 150 180', {
      sourceLoader: () => null,
    });
    expect(block).toBe('');
  });

  it('embeds reference template source when category hits', () => {
    const fakeSource = `import { x } from 'remotion';
const PARAMS = { primaryColor: "#7C3AED" } as const;
export const Demo = () => null;`;
    const block = buildReferenceBlock('animated bar chart with values', {
      sourceLoader: () => fakeSource,
    });
    expect(block).toContain('REFERENCE TEMPLATE (RAG, TM-74)');
    expect(block).toContain('chart');
    expect(block).toContain('bar-chart');
    expect(block).toContain(fakeSource);
    expect(block).toContain('END REFERENCE');
  });

  it('truncates very long reference sources', () => {
    const huge = 'X'.repeat(20_000);
    const block = buildReferenceBlock('bar chart', { sourceLoader: () => huge });
    expect(block).toContain('truncated for context budget');
    expect(block.length).toBeLessThan(20_000);
  });
});

describe('retrieval — retrieveReferenceForPrompt (top-level)', () => {
  it('returns null/empty when no category', () => {
    const r = retrieveReferenceForPrompt('something cool');
    expect(r.category).toBeNull();
    expect(r.reference).toBeNull();
    expect(r.addendum).toBe('');
  });

  it('returns category + reference + addendum for chart prompts', () => {
    const r = retrieveReferenceForPrompt('animated bar chart with sales 120,150,180');
    expect(r.category).toBe('chart');
    expect(r.reference?.id).toBe('bar-chart');
    // addendum either contains the reference block or is empty (when fs read
    // fails in the test sandbox). We only require the category/reference
    // selection here.
    expect(typeof r.addendum).toBe('string');
  });
});
