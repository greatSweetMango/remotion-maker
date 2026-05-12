/**
 * Unit tests for validate_remotion_code.
 * Run via: `npm --prefix plugin/remotion-eval test`
 * (Uses Node's built-in node:test runner + tsx for TS loading.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRemotionCode, countParamsKeys } from '../src/validate.ts';

const GOOD = `
const PARAMS = {
  primaryColor: '#ff0000', // type: color
  speed: 1, // type: range min: 0 max: 5
} as const;

const Scene = ({
  primaryColor = PARAMS.primaryColor,
  speed = PARAMS.speed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ background: primaryColor }} />;
};
`;

test('accepts well-formed Remotion code', () => {
  const r = validateRemotionCode(GOOD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.paramsCount, 2);
  assert.ok(r.transpiled && r.transpiled.length > 0, 'should produce transpiled JS');
  assert.equal(r.warnings.length, 0);
});

test('rejects eval', () => {
  const r = validateRemotionCode(`const X = () => eval('1+1');`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('eval')));
  assert.equal(r.transpiled, null, 'should skip transpile on safety failure');
});

test('rejects fetch / network', () => {
  const r = validateRemotionCode(`const X = () => { fetch('/x'); return null; };`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('fetch')));
});

test('rejects setTimeout and while(true)', () => {
  const r = validateRemotionCode(`const X = () => { while(true) {} setTimeout(()=>{}, 0); };`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('setTimeout')));
  assert.ok(r.errors.some((e) => e.includes('while(true)')));
});

test('rejects recursive promise chain', () => {
  const r = validateRemotionCode(`
    function loop() { return Promise.resolve().then(loop); }
    loop();
  `);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /recursive Promise/.test(e)));
});

test('warns on missing PARAMS', () => {
  const r = validateRemotionCode(`const Foo = () => null;`);
  // safety-clean ⇒ ok stays true; structural issue surfaces as warning
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /PARAMS/.test(w)));
});

test('warns on missing PascalCase component', () => {
  const r = validateRemotionCode(`const PARAMS = { x: 1 /* type: range */ };`);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /PascalCase/.test(w)));
});

test('returns errors on syntax error (sucrase)', () => {
  const r = validateRemotionCode(`const PARAMS = { broken: `);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('transpile:')));
});

test('returns invalid-input on non-string', () => {
  // @ts-expect-error testing runtime guard
  const r = validateRemotionCode(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].startsWith('invalid-input'));
});

test('returns invalid-input on empty string', () => {
  const r = validateRemotionCode('   ');
  assert.equal(r.ok, false);
});

test('countParamsKeys handles empty PARAMS', () => {
  assert.equal(countParamsKeys('const PARAMS = {} as const;'), 0);
});

test('countParamsKeys handles multiline PARAMS', () => {
  const c = `const PARAMS = {
    a: 1,
    b: 2,
    c: 3,
  } as const;`;
  assert.equal(countParamsKeys(c), 3);
});

test('does not mistake SCREAMING_CASE for component (TM-58 gotcha)', () => {
  const code = `const PARAMS = { x: 1 /* type: range */ };
const Scene = () => null;`;
  const r = validateRemotionCode(code);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 0, 'Scene satisfies the PascalCase check; no warnings expected');
});
