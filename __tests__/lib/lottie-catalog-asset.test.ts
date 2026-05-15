/**
 * TM-140 / ADR-0027 — `isValidCatalogueLottieAsset` shape predicate.
 *
 * Mirrors `audio-catalog-track.test.ts`. The wrapper component
 * (`<CatalogueLottie>`) calls this on every render to decide whether to
 * fetch JSON / emit a real `<Lottie>` tag or render `null`. The
 * predicate must:
 *   - accept catalogue-shaped strings (with or without `lottie/` prefix)
 *   - reject anything that could escape `public/lottie/` (traversal,
 *     embedded slashes, backslashes)
 *   - reject non-strings, empty strings, wrong extensions
 *   - never throw (it runs inside a Remotion render frame)
 */
import { isValidCatalogueLottieAsset } from '@/lib/lottie/manifest';

describe('isValidCatalogueLottieAsset', () => {
  describe('accepts', () => {
    it.each([
      'bear-walk.json',
      'lottie/bear-walk.json',
      'dog-running.json',
      'person-dancing.json',
      'cat-idle.json',
      'a.json',
      'a-b-c-1-2-3.json',
      'lottie/a.json',
    ])('valid catalogue shape: %s', (asset) => {
      expect(isValidCatalogueLottieAsset(asset)).toBe(true);
    });
  });

  describe('rejects shape violations', () => {
    it.each([
      ['empty string', ''],
      ['wrong extension .mp3', 'bear-walk.mp3'],
      ['wrong extension .lottie', 'bear-walk.lottie'],
      ['no extension', 'bear-walk'],
      ['uppercase letters', 'BearWalk.json'],
      ['underscore', 'bear_walk.json'],
      ['space', 'bear walk.json'],
      ['leading dot', '.bear.json'],
      ['leading slash', '/bear.json'],
      ['nested path', 'sub/bear.json'],
      ['lottie/ + nested path', 'lottie/sub/bear.json'],
      ['traversal up', '../etc/passwd'],
      ['traversal up via lottie prefix', 'lottie/../etc/passwd'],
      ['backslash traversal', 'lottie\\..\\etc\\passwd'],
      ['lottie/ + traversal', 'lottie/../secret.json'],
      ['absolute http url', 'http://evil.com/x.json'],
      ['absolute https url', 'https://evil.com/x.json'],
      ['data uri', 'data:application/json;base64,AAAA'],
      ['javascript:', 'javascript:alert(1)'],
    ])('rejects %s', (_label, asset) => {
      expect(isValidCatalogueLottieAsset(asset)).toBe(false);
    });
  });

  describe('rejects non-strings', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['object', { filename: 'bear.json' }],
      ['array', ['bear.json']],
      ['boolean', true],
    ])('rejects %s', (_label, value) => {
      expect(isValidCatalogueLottieAsset(value as unknown)).toBe(false);
    });
  });

  it('never throws', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      NaN,
      Infinity,
      Symbol('x'),
      () => 'bear.json',
      Object.create(null),
    ];
    for (const v of inputs) {
      expect(() => isValidCatalogueLottieAsset(v)).not.toThrow();
    }
  });
});
