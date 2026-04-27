import { extractParameters } from '@/lib/ai/extract-params';

describe('extractParameters — sequence annotation (TM-28)', () => {
  it('parses `sequence:` annotation with single id', () => {
    const code = `
const PARAMS = {
  feature1Title: "AI", // type: text, sequence: feature-1
} as const;
`;
    const params = extractParameters(code);
    expect(params).toHaveLength(1);
    expect(params[0].sequenceIds).toEqual(['feature-1']);
  });

  it('parses pipe-separated multi-sequence membership', () => {
    const code = `
const PARAMS = {
  productName: "X", // type: text, sequence: intro|outro
} as const;
`;
    const params = extractParameters(code);
    expect(params[0].sequenceIds).toEqual(['intro', 'outro']);
  });

  it('parses `global` sentinel', () => {
    const code = `
const PARAMS = {
  primaryColor: "#fff", // type: color, sequence: global
} as const;
`;
    const params = extractParameters(code);
    expect(params[0].sequenceIds).toEqual(['global']);
  });

  it('omits sequenceIds when annotation absent (backward compat)', () => {
    const code = `
const PARAMS = {
  speed: 1.2, // type: range, min: 0, max: 5
} as const;
`;
    const params = extractParameters(code);
    expect(params[0].sequenceIds).toBeUndefined();
  });

  it('preserves existing min/max parsing alongside sequence annotation', () => {
    const code = `
const PARAMS = {
  fontSize: 24, // type: range, min: 8, max: 96, sequence: feature-1
} as const;
`;
    const params = extractParameters(code);
    expect(params[0]).toMatchObject({
      key: 'fontSize',
      type: 'range',
      min: 8,
      max: 96,
      sequenceIds: ['feature-1'],
    });
  });
});
