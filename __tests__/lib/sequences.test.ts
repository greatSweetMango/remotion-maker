import {
  extractSequences,
  activeSequenceAt,
  inferParamSequences,
  filterParamsForSequence,
  GLOBAL_SEQUENCE_ID,
  ALL_MODE_ID,
} from '@/lib/sequences';
import type { Parameter } from '@/types';

const PRODUCT_INTRO = `
  <Sequence from={0} durationInFrames={240} name="intro">x</Sequence>
  <Sequence from={240} durationInFrames={450} name="feature-1">x</Sequence>
  <Sequence from={690} durationInFrames={450} name="feature-2">x</Sequence>
  <Sequence from={1140} durationInFrames={420} name="feature-3">x</Sequence>
  <Sequence from={1560} durationInFrames={240} name="outro">x</Sequence>
`;

describe('extractSequences', () => {
  it('parses TM-27 ProductIntro segments in source order', () => {
    const segs = extractSequences(PRODUCT_INTRO);
    expect(segs.map(s => s.id)).toEqual(['intro', 'feature-1', 'feature-2', 'feature-3', 'outro']);
    expect(segs[0]).toMatchObject({ from: 0, durationInFrames: 240, label: 'Intro' });
    expect(segs[3]).toMatchObject({ from: 1140, durationInFrames: 420 });
  });

  it('returns empty for source with no <Sequence> tags', () => {
    expect(extractSequences('<div>nothing</div>')).toEqual([]);
  });

  it('dedupes by id when names collide', () => {
    const dup = `
      <Sequence from={0} durationInFrames={60} name="intro">a</Sequence>
      <Sequence from={60} durationInFrames={60} name="intro">b</Sequence>
    `;
    const segs = extractSequences(dup);
    expect(segs).toHaveLength(1);
    expect(segs[0].from).toBe(0);
  });

  it('handles single-quoted and brace-string name attributes', () => {
    const src = `
      <Sequence from={0} durationInFrames={30} name='one'>a</Sequence>
      <Sequence from={30} durationInFrames={30} name={"two"}>b</Sequence>
    `;
    const segs = extractSequences(src);
    expect(segs.map(s => s.id)).toEqual(['one', 'two']);
  });

  it('sorts by start frame even when source order differs', () => {
    const src = `
      <Sequence from={100} durationInFrames={50} name="b">b</Sequence>
      <Sequence from={0} durationInFrames={100} name="a">a</Sequence>
    `;
    const segs = extractSequences(src);
    expect(segs.map(s => s.id)).toEqual(['a', 'b']);
  });
});

describe('activeSequenceAt', () => {
  const segs = extractSequences(PRODUCT_INTRO);

  it('returns intro for frame 0', () => {
    expect(activeSequenceAt(segs, 0)?.id).toBe('intro');
  });
  it('returns intro at frame 239 (boundary)', () => {
    expect(activeSequenceAt(segs, 239)?.id).toBe('intro');
  });
  it('returns feature-1 at exact start frame 240', () => {
    expect(activeSequenceAt(segs, 240)?.id).toBe('feature-1');
  });
  it('returns outro for the last frame', () => {
    expect(activeSequenceAt(segs, 1799)?.id).toBe('outro');
  });
  it('clamps past-end to last sequence', () => {
    expect(activeSequenceAt(segs, 99999)?.id).toBe('outro');
  });
  it('returns null for empty segment list', () => {
    expect(activeSequenceAt([], 10)).toBeNull();
  });
});

describe('inferParamSequences (no explicit annotation)', () => {
  const segs = extractSequences(PRODUCT_INTRO);
  const mk = (key: string, group: Parameter['group'] = 'text'): Parameter => ({
    key, label: key, group, type: 'text', value: '',
  });

  it('color params → global', () => {
    expect(inferParamSequences(mk('primaryColor', 'color'), segs)).toEqual([GLOBAL_SEQUENCE_ID]);
  });

  it('feature1Title → feature-1', () => {
    expect(inferParamSequences(mk('feature1Title'), segs)).toEqual(['feature-1']);
  });

  it('ctaText → contains "outro" word? no → falls back to global', () => {
    // ctaText has no segment-id prefix and no intro/outro substring → global.
    expect(inferParamSequences(mk('ctaText'), segs)).toEqual([GLOBAL_SEQUENCE_ID]);
  });

  it('introHero → matches intro via substring', () => {
    expect(inferParamSequences(mk('introHero'), segs)).toEqual(['intro']);
  });

  it('outroMessage → matches outro via substring', () => {
    expect(inferParamSequences(mk('outroMessage'), segs)).toEqual(['outro']);
  });

  it('completely unrelated key → global', () => {
    expect(inferParamSequences(mk('mysteryKey'), segs)).toEqual([GLOBAL_SEQUENCE_ID]);
  });
});

describe('filterParamsForSequence', () => {
  const segs = extractSequences(PRODUCT_INTRO);
  const params: Parameter[] = [
    { key: 'productName', label: 'Product Name', group: 'text', type: 'text', value: 'X', sequenceIds: ['intro', 'outro'] },
    { key: 'feature1Title', label: 'F1 Title', group: 'text', type: 'text', value: 'X', sequenceIds: ['feature-1'] },
    { key: 'feature2Title', label: 'F2 Title', group: 'text', type: 'text', value: 'X', sequenceIds: ['feature-2'] },
    { key: 'primaryColor', label: 'Color', group: 'color', type: 'color', value: '#fff', sequenceIds: ['global'] },
    // No annotation → infer (key has no segment prefix → global)
    { key: 'mysteryKnob', label: 'Mystery', group: 'other', type: 'text', value: 'X' },
  ];

  it('intro: shows productName + primaryColor + mysteryKnob, hides feature-1/2 titles', () => {
    const out = filterParamsForSequence(params, segs, 'intro');
    expect(out.map(p => p.key)).toEqual(['productName', 'primaryColor', 'mysteryKnob']);
  });

  it('feature-1: shows feature1Title + primaryColor + mysteryKnob', () => {
    const out = filterParamsForSequence(params, segs, 'feature-1');
    expect(out.map(p => p.key)).toEqual(['feature1Title', 'primaryColor', 'mysteryKnob']);
  });

  it('all-mode returns every param', () => {
    const out = filterParamsForSequence(params, segs, ALL_MODE_ID);
    expect(out).toEqual(params);
  });

  it('no segments → no filtering (degenerate template)', () => {
    const out = filterParamsForSequence(params, [], 'feature-1');
    expect(out).toEqual(params);
  });
});
