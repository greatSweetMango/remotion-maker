/**
 * Unit tests for extract_params (Node port of src/lib/ai/extract-params.ts).
 * Run via: `npm --prefix plugin/remotion-eval test`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractParameters, extractParamsTool } from '../src/extract.ts';

test('extracts color + range with min/max', () => {
  const code = `
const PARAMS = {
  primaryColor: '#ff0000', // type: color
  speed: 1, // type: range min: 0 max: 5
} as const;
`;
  const out = extractParameters(code);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    key: 'primaryColor',
    label: 'Primary Color',
    group: 'color',
    type: 'color',
    value: '#ff0000',
    min: undefined,
    max: undefined,
    unit: undefined,
    options: undefined,
    sequenceIds: undefined,
    regenPrompt: undefined,
  });
  assert.equal(out[1].type, 'range');
  assert.equal(out[1].value, 1);
  assert.equal(out[1].min, 0);
  assert.equal(out[1].max, 5);
});

test('handles boolean / text / select', () => {
  const code = `
const PARAMS = {
  showLogo: true, // type: boolean
  title: 'Hello', // type: text
  variant: 'a', // type: select options: a|b|c
} as const;
`;
  const out = extractParameters(code);
  assert.equal(out.length, 3);
  assert.equal(out[0].value, true);
  assert.equal(out[0].type, 'boolean');
  assert.equal(out[1].value, 'Hello');
  assert.equal(out[1].group, 'text');
  assert.deepEqual(out[2].options, ['a', 'b', 'c']);
});

test('infers timing group from key name (duration/speed/delay)', () => {
  const code = `
const PARAMS = {
  fadeDuration: 30, // type: range min: 0 max: 120 unit: frames
} as const;
`;
  const [p] = extractParameters(code);
  assert.equal(p.group, 'timing');
  assert.equal(p.unit, 'frames');
});

test('infers size group from key name (fontSize/width/radius)', () => {
  const code = `
const PARAMS = {
  fontSize: 24, // type: range min: 8 max: 96
} as const;
`;
  const [p] = extractParameters(code);
  assert.equal(p.group, 'size');
});

test('media group for image / font', () => {
  const code = `
const PARAMS = {
  bg: 'https://x', // type: image
  family: 'Inter', // type: font
} as const;
`;
  const out = extractParameters(code);
  assert.equal(out[0].group, 'media');
  assert.equal(out[1].group, 'media');
});

test('parses sequenceIds annotation', () => {
  const code = `
const PARAMS = {
  introText: 'Hi', // type: text sequence: intro|global
} as const;
`;
  const [p] = extractParameters(code);
  assert.deepEqual(p.sequenceIds, ['intro', 'global']);
});

test('parses regen_prompt for image params (ADR-0022)', () => {
  const code = `
const PARAMS = {
  hero: "data:..." , // type: image, regen_prompt: "곰돌이 캐릭터, 친근한"
} as const;
`;
  const [p] = extractParameters(code);
  assert.equal(p.type, 'image');
  assert.equal(p.regenPrompt, '곰돌이 캐릭터, 친근한');
});

test('returns empty array when no PARAMS const present', () => {
  const out = extractParameters(`const Foo = () => null;`);
  assert.deepEqual(out, []);
});

test('extractParamsTool envelope: invalid input', () => {
  // @ts-expect-error runtime guard
  const r = extractParamsTool(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].startsWith('invalid-input'));
});

test('extractParamsTool envelope: valid input returns paramsCount', () => {
  const code = `
const PARAMS = {
  color: '#fff', // type: color
  count: 3, // type: range min: 0 max: 10
} as const;
`;
  const r = extractParamsTool(code);
  assert.equal(r.ok, true);
  assert.equal(r.paramsCount, 2);
  assert.equal(r.parameters.length, 2);
});

test('label derivation: camelCase to Title Case', () => {
  const code = `
const PARAMS = {
  someLongKeyName: 1, // type: range
} as const;
`;
  const [p] = extractParameters(code);
  assert.equal(p.label, 'Some Long Key Name');
});
