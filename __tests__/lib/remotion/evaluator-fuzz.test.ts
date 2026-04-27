/**
 * @jest-environment jsdom
 *
 * TM-48 — Evaluator robustness: 8 known traps + 12 fuzz cases.
 *
 * Acceptance: every case must return a structured `EvaluationResult` (no
 * thrown exception, no app crash) AND every failure case must produce a
 * non-empty Korean `userMessage` with no raw stack trace.
 */
import {
  evaluateComponentDetailed,
  clearEvaluatorCache,
  type EvaluatorErrorKind,
} from '@/lib/remotion/evaluator';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';

beforeEach(() => clearEvaluatorCache());

// Suppress dev-only console warns from the evaluator during fuzz runs.
let warnSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warnSpy.mockRestore());

interface FuzzCase {
  n: number;
  label: string;
  /** When `expect.layer` === 'sandbox', the input is checked against the
   *  pre-flight deny list; otherwise it is sent to the evaluator. */
  layer?: 'sandbox' | 'evaluator';
  jsCode: unknown;
  expect:
    | { ok: true }
    | { ok: false; kind: EvaluatorErrorKind }
    | { ok: false; sandbox: true };
}

const CASES: FuzzCase[] = [
  // --- known traps ---
  { n: 1, label: 'syntax error: const = ;', jsCode: `const = ;`, expect: { ok: false, kind: 'parse' } },
  { n: 2, label: 'undefined component reference', jsCode: `const Comp = () => Foo;`, expect: { ok: true } /* Foo is referenced inside the function body — not evaluated until render */ },
  { n: 3, label: 'PARAMS only, no Component', jsCode: `const PARAMS = { color: '#fff' };`, expect: { ok: false, kind: 'missing-component' } },
  { n: 4, label: 'PARAMS + Component (regression)', jsCode: `const PARAMS = {}; const Component = () => null;`, expect: { ok: true } },
  // Note: an actual `for(;;){}` cannot be intercepted post-hoc by the
  // evaluator's wall-clock timer (the call never returns). Sandbox layer
  // statically rejects the canonical infinite-loop syntactic forms.
  { n: 5, label: 'for(;;) infinite loop — sandbox layer', layer: 'sandbox', jsCode: `for(;;){} const Component = () => null;`, expect: { ok: false, sandbox: true } },
  { n: 6, label: 'setTimeout(string) — sandbox layer', layer: 'sandbox', jsCode: `setTimeout("alert(1)", 0); const Component = () => null;`, expect: { ok: false, sandbox: true } },
  { n: 7, label: 'no component identifier at all', jsCode: `const x = 1;`, expect: { ok: false, kind: 'missing-component' } },
  { n: 8, label: 'lowercase component name', jsCode: `const component = () => null;`, expect: { ok: false, kind: 'missing-component' } },

  // --- 12 fuzz cases ---
  { n: 9, label: 'function declaration', jsCode: `function Comp(){ return null; }`, expect: { ok: true } },
  { n: 10, label: 'reference to undeclared module-scope identifier', jsCode: `const value = a + 1; const Comp = () => null;`, expect: { ok: false, kind: 'runtime' } },
  { n: 11, label: 'component throws — but only at render time', jsCode: `const Comp = () => { throw new Error('boom'); };`, expect: { ok: true } /* factory OK; ErrorBoundary catches at render */ },
  { n: 12, label: 'stray `import x from "fs"` (after sanitize, still rejected by parser)', jsCode: `import x from 'fs'; const Comp = () => null;`, expect: { ok: false, kind: 'parse' } },
  { n: 13, label: 'unclosed JSX tag', jsCode: `const Comp = () => <div>;`, expect: { ok: false, kind: 'parse' } },
  { n: 14, label: 'duplicate const declaration', jsCode: `const Comp = () => null; const Comp = () => null;`, expect: { ok: false, kind: 'parse' } },
  { n: 15, label: 'large code (~50KB) still evaluates', jsCode: `const Comp = () => null; ${'// pad\n'.repeat(7000)}`, expect: { ok: true } },
  { n: 16, label: 'unicode component name (regex miss → missing)', jsCode: `const Α = () => null;`, expect: { ok: false, kind: 'missing-component' } },
  { n: 17, label: 'syntax error inside a comment is ignored', jsCode: `/* const = ; */\nconst Comp = () => null;`, expect: { ok: true } },
  { n: 18, label: 'component returning undefined — factory OK', jsCode: `const Comp = () => undefined;`, expect: { ok: true } },
  { n: 19, label: 'invalid input: null', jsCode: null, expect: { ok: false, kind: 'invalid-input' } },
  { n: 20, label: 'forbidden __proto__ — sandbox layer', layer: 'sandbox', jsCode: `const Comp = () => null; ({}).__proto__ = {};`, expect: { ok: false, sandbox: true } },
];

describe('TM-48 fuzz — 20 cases', () => {
  for (const c of CASES) {
    test(`#${c.n} ${c.label}`, () => {
      // Sandbox-layer cases are pre-flight rejected; the evaluator never sees them.
      if (c.layer === 'sandbox') {
        const v = validateCode(typeof c.jsCode === 'string' ? c.jsCode : '');
        if ('sandbox' in c.expect && c.expect.sandbox) {
          expect(v.valid).toBe(false);
          expect(v.errors.length).toBeGreaterThan(0);
        }
        return;
      }

      // Mimic real call site: pre-validate, sanitize, evaluate.
      let toEval: unknown = c.jsCode;
      if (typeof toEval === 'string') {
        const v = validateCode(toEval);
        if (v.valid) toEval = sanitizeCode(toEval);
      }

      const result = evaluateComponentDetailed(toEval);

      if (c.expect.ok === true) {
        if (result.error) {
          throw new Error(
            `case #${c.n} expected ok but got ${result.error.kind}: ${result.error.raw}`,
          );
        }
        expect(typeof result.component).toBe('function');
      } else {
        expect(result.component).toBeNull();
        expect(result.error).not.toBeNull();
        expect(result.error!.kind).toBe(c.expect.kind);
        // userMessage must be Korean-friendly, never a raw stack trace.
        expect(result.error!.userMessage).toMatch(/[가-힣]/);
        expect(result.error!.userMessage).not.toMatch(/at .* \(.*\.[tj]sx?:\d+/);
        // raw is allowed (dev-only) but must not be the userMessage.
        if (result.error!.raw) {
          expect(result.error!.userMessage).not.toEqual(result.error!.raw);
        }
      }
    });
  }
});

describe('TM-48 — never throws, never crashes the host', () => {
  test('rapid-fire 200 random short strings: zero throws', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz{}();<>=/+- \n';
    for (let i = 0; i < 200; i++) {
      let s = '';
      const len = 1 + Math.floor(Math.random() * 60);
      for (let j = 0; j < len; j++) s += chars[Math.floor(Math.random() * chars.length)];
      // Should not throw under any circumstances.
      expect(() => evaluateComponentDetailed(s)).not.toThrow();
    }
  });

  test('non-string inputs are handled gracefully', () => {
    for (const bad of [undefined, null, 0, false, {}, [], 123n] as unknown[]) {
      const r = evaluateComponentDetailed(bad);
      expect(r.component).toBeNull();
      expect(r.error?.kind).toBe('invalid-input');
    }
  });

  test('empty string is handled as invalid-input', () => {
    const r = evaluateComponentDetailed('');
    expect(r.error?.kind).toBe('invalid-input');
  });
});
