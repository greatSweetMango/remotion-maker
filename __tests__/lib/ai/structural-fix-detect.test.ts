/**
 * TM-174 — structural-fix verb detection on the edit path.
 *
 * Coverage:
 *   1. Korean structural verbs trigger (positive).
 *   2. English structural verbs trigger (positive, case-insensitive).
 *   3. Generic PARAMS-level edit prompts DO NOT trigger (negative).
 *   4. Non-string / empty input returns triggered:false (defers to validatePrompt).
 *   5. Word-boundary correctness — "playout" must not match "layout".
 *   6. Rejection payload shape (stable client contract).
 */
import {
  detectStructuralFixRequest,
  buildStructuralRegenRejection,
} from '@/lib/ai/structural-fix-detect';

describe('detectStructuralFixRequest — positive (KO)', () => {
  const koCases: Array<[string, string]> = [
    ['composition 고쳐줘 재생성해줘', '재생성'],
    ['처음부터 다시 만들어줘', '처음부터'],
    ['완전 새로 만들어주세요', '완전 새로'],
    ['완전새로 부탁', '완전새로'],
    ['구조 수정 필요', '구조 수정'],
    ['레이아웃을 바꿔주세요', '레이아웃'],
    ['컴포지션을 다시', '컴포지션'],
    ['전체 새로 만들어줘', '전체 새로'],
    ['전부 다시 해줘', '전부 다시'],
    ['다시 만들어줘', '다시 만들'],
    ['새로 만들어주세요', '새로 만들'],
  ];

  it.each(koCases)('triggers on %s', (input, expectedTerm) => {
    const result = detectStructuralFixRequest(input);
    expect(result.triggered).toBe(true);
    expect(result.matchedLocale).toBe('ko');
    expect(result.matchedTerm).toBe(expectedTerm);
  });
});

describe('detectStructuralFixRequest — positive (EN)', () => {
  const enCases: Array<[string, string]> = [
    ['please regenerate the scene', 'regenerate'],
    ['REGEN this', 'regen'],
    ['redo it', 'redo'],
    ['build it from scratch', 'from scratch'],
    ['can you start over', 'start over'],
    ['I want something completely new', 'completely new'],
    ['totally new look', 'totally new'],
    ['entirely new concept', 'entirely new'],
    ['full regen please', 'full regen'],
    ['full regeneration', 'full regen'],
    ['structure fix needed', 'structure fix'],
    ['please fix the structure', 'fix the structure'],
    ['structural fix', 'structural fix'],
    ['change the layout', 'layout'],
    ['fix the composition', 'composition'],
    ['rebuild this', 'rebuild'],
    ['rewrite from scratch', 'rewrite from scratch'],
  ];

  it.each(enCases)('triggers on %s', (input, expectedTerm) => {
    const result = detectStructuralFixRequest(input);
    expect(result.triggered).toBe(true);
    expect(result.matchedLocale).toBe('en');
    expect(result.matchedTerm).toBe(expectedTerm);
  });
});

describe('detectStructuralFixRequest — negative (PARAMS-level edits)', () => {
  const negativeCases: string[] = [
    'change the primary color to red',
    '글자 크기 키워줘',
    '색을 파란색으로 바꿔줘',
    'make the text bigger',
    'speed up the animation a little',
    '조금만 더 빠르게',
    'use a darker background',
    'set the title to Hello World',
    // Borderline: contains 다시 alone (no structural context) — must not trip.
    '한 번 더 다시 보여줘',
    // Borderline: "fix" alone is generic, must not trip.
    'please fix the color',
    // Borderline: "수정" alone is generic.
    '색상 수정해줘',
    // Borderline: "redesign" intentionally not in verb list (too ambiguous).
    'redesign the colors',
  ];

  it.each(negativeCases)('does NOT trigger on: %s', (input) => {
    const result = detectStructuralFixRequest(input);
    expect(result.triggered).toBe(false);
    expect(result.matchedTerm).toBeNull();
    expect(result.matchedLocale).toBeNull();
  });
});

describe('detectStructuralFixRequest — word boundary correctness', () => {
  it('does NOT match "layout" inside "playout"', () => {
    expect(detectStructuralFixRequest('schedule a playout').triggered).toBe(false);
  });

  it('does NOT match "regen" inside "regenerative" — wait, it should via "regenerate"', () => {
    // "regenerative" contains "regenerate" prefix but \b boundary at end of
    // "regenerate" requires non-word after — "regenerative" has 'i' (word
    // char) after 'regenerate', so \bregenerate\b must NOT match.
    // It DOES match \bregen\b since 'regen' is followed by 'e' (word char), no.
    // Both should be false.
    expect(detectStructuralFixRequest('regenerative medicine').triggered).toBe(false);
  });

  it('does NOT match "redo" inside "redone"', () => {
    expect(detectStructuralFixRequest('the work is redone').triggered).toBe(false);
  });

  it('does NOT match "layout" inside a URL fragment "layouts/main"', () => {
    // \blayout\b — '/' is non-word, 's' is word → 'layouts' should NOT match.
    expect(detectStructuralFixRequest('check the layouts/main page').triggered).toBe(false);
  });
});

describe('detectStructuralFixRequest — edge inputs', () => {
  it('returns triggered:false for empty string', () => {
    expect(detectStructuralFixRequest('').triggered).toBe(false);
  });

  it('returns triggered:false for non-string input', () => {
    expect(detectStructuralFixRequest(null).triggered).toBe(false);
    expect(detectStructuralFixRequest(undefined).triggered).toBe(false);
    expect(detectStructuralFixRequest(42).triggered).toBe(false);
    expect(detectStructuralFixRequest({ prompt: 'regenerate' }).triggered).toBe(false);
  });
});

describe('buildStructuralRegenRejection', () => {
  it('returns the documented payload shape for a KO match', () => {
    const detection = detectStructuralFixRequest('처음부터 다시');
    const payload = buildStructuralRegenRejection(detection);
    expect(payload.code).toBe('STRUCTURAL_REGEN_REQUIRED');
    expect(payload.matchedLocale).toBe('ko');
    expect(payload.matchedTerm).toBe('처음부터');
    expect(payload.error).toMatch(/구조 변경/);
    expect(payload.errorEn).toMatch(/structural/i);
    expect(payload.suggestedAction).toEqual({ route: '/studio', queryParam: 'prompt' });
  });

  it('returns the documented payload shape for an EN match', () => {
    const detection = detectStructuralFixRequest('please regenerate');
    const payload = buildStructuralRegenRejection(detection);
    expect(payload.code).toBe('STRUCTURAL_REGEN_REQUIRED');
    expect(payload.matchedLocale).toBe('en');
    expect(payload.matchedTerm).toBe('regenerate');
  });

  it('throws when called on a non-triggered detection (programmer error guard)', () => {
    const detection = detectStructuralFixRequest('change the color');
    expect(() => buildStructuralRegenRejection(detection)).toThrow();
  });
});
