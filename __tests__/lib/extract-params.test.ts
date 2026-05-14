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

  // TM-88 / ADR-0022 — regen_prompt annotation for type:image PARAMS
  it('parses double-quoted regen_prompt annotation on type:image', () => {
    const code = `
const PARAMS = {
  hero: "data:image/png;base64,AAAA", // type: image, regen_prompt: "a cute bear walking in a meadow"
} as const;
`;
    const params = extractParameters(code);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('image');
    expect(params[0].regenPrompt).toBe('a cute bear walking in a meadow');
  });

  it('parses regen_prompt with embedded commas (the comma-grammar foot-gun)', () => {
    const code = `
const PARAMS = {
  hero: "x", // type: image, regen_prompt: "곰돌이, 친근한 캐릭터, watercolor"
} as const;
`;
    const params = extractParameters(code);
    expect(params[0].regenPrompt).toBe('곰돌이, 친근한 캐릭터, watercolor');
  });

  it('accepts single-quoted regen_prompt', () => {
    const code = `
const PARAMS = {
  hero: "x", // type: image, regen_prompt: 'corgi on a beach'
} as const;
`;
    const params = extractParameters(code);
    expect(params[0].regenPrompt).toBe('corgi on a beach');
  });

  it('leaves regenPrompt undefined when annotation absent (backward compat)', () => {
    const code = `
const PARAMS = {
  hero: "x", // type: image
} as const;
`;
    const params = extractParameters(code);
    expect(params[0].regenPrompt).toBeUndefined();
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

describe('extractParameters — bgmTrack (TM-130 / ADR-0026 §4)', () => {
  it('parses explicit `// type: bgmTrack` annotation', () => {
    const code = `
const PARAMS = {
  bgmTrack: "audio/chill-sunrise.mp3", // type: bgmTrack
} as const;
`;
    const params = extractParameters(code);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('bgmTrack');
    expect(params[0].group).toBe('media');
    expect(params[0].value).toBe('audio/chill-sunrise.mp3');
  });

  it('auto-detects bgmTrack when key is exactly "bgmTrack" + value matches catalogue regex', () => {
    const code = `
const PARAMS = {
  bgmTrack: "audio/upbeat-runner.mp3",
} as const;
`;
    const params = extractParameters(code);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('bgmTrack');
    expect(params[0].value).toBe('audio/upbeat-runner.mp3');
  });

  it('auto-detects bgmTrack when key suffix is "Track" + catalogue value', () => {
    const code = `
const PARAMS = {
  introTrack: "audio/cinematic-aurora.mp3",
} as const;
`;
    const params = extractParameters(code);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('bgmTrack');
    expect(params[0].key).toBe('introTrack');
  });

  it('does NOT auto-detect when value is not a catalogue path', () => {
    const code = `
const PARAMS = {
  bgmTrack: "https://example.com/foo.mp3",
} as const;
`;
    const params = extractParameters(code);
    expect(params).toHaveLength(0);
  });

  it('does NOT auto-detect when key suffix differs (e.g. "title")', () => {
    const code = `
const PARAMS = {
  songName: "audio/lofi-cassette.mp3",
} as const;
`;
    const params = extractParameters(code);
    // key doesn't end in `Track` and isn't `bgmTrack`, so we don't promote
    expect(params).toHaveLength(0);
  });
});
