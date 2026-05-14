/**
 * TM-132 / ADR-0026 §B amendment — `isValidCatalogTrack` shape predicate.
 *
 * The wrapper component (`<CatalogueAudio>`) calls this on every render to
 * decide whether to emit a real `<Audio>` tag or render `null`. The
 * predicate must:
 *   - accept catalogue-shaped strings (with or without `audio/` prefix)
 *   - reject anything that could escape `public/audio/` (traversal,
 *     embedded slashes, backslashes)
 *   - reject non-strings, empty strings, wrong extensions
 *   - never throw (it runs inside a Remotion render frame)
 */
import { isValidCatalogTrack } from '@/lib/audio/manifest';

describe('isValidCatalogTrack', () => {
  describe('accepts', () => {
    it.each([
      'chill-sunrise.mp3',
      'audio/chill-sunrise.mp3',
      'upbeat-runner.mp3',
      'cinematic-dawn.mp3',
      'lofi-rainy.mp3',
      'electronic-pulse.mp3',
      'a.mp3',
      'a-b-c-1-2-3.mp3',
      'audio/a.mp3',
    ])('valid catalogue shape: %s', (track) => {
      expect(isValidCatalogTrack(track)).toBe(true);
    });
  });

  describe('rejects shape violations', () => {
    it.each([
      ['empty string', ''],
      ['wrong extension .wav', 'chill.wav'],
      ['wrong extension .mp4', 'chill.mp4'],
      ['no extension', 'chill'],
      ['uppercase letters', 'Chill.mp3'],
      ['underscore', 'chill_sunrise.mp3'],
      ['space', 'chill sunrise.mp3'],
      ['leading dot', '.chill.mp3'],
      ['leading slash', '/chill.mp3'],
      ['nested path', 'sub/chill.mp3'],
      ['audio/ + nested path', 'audio/sub/chill.mp3'],
      ['traversal up', '../etc/passwd'],
      ['traversal up via audio prefix', 'audio/../etc/passwd'],
      ['backslash traversal', 'audio\\..\\etc\\passwd'],
      ['audio/ + traversal', 'audio/../secret.mp3'],
      ['absolute http url', 'http://evil.com/x.mp3'],
      ['absolute https url', 'https://evil.com/x.mp3'],
      ['data uri', 'data:audio/mp3;base64,AAAA'],
      ['javascript:', 'javascript:alert(1)'],
    ])('rejects %s', (_label, track) => {
      expect(isValidCatalogTrack(track)).toBe(false);
    });
  });

  describe('rejects non-strings', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['object', { filename: 'chill.mp3' }],
      ['array', ['chill.mp3']],
      ['boolean', true],
    ])('rejects %s', (_label, value) => {
      expect(isValidCatalogTrack(value as unknown)).toBe(false);
    });
  });

  it('never throws', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      NaN,
      Infinity,
      Symbol('x'),
      () => 'chill.mp3',
      Object.create(null),
    ];
    for (const v of inputs) {
      expect(() => isValidCatalogTrack(v)).not.toThrow();
    }
  });
});
