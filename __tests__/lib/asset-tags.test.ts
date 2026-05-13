import {
  decodeTags,
  encodeTags,
  normalizeTags,
  normalizeFolder,
  TagsValidationError,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ASSET,
} from '@/lib/asset/tags';

describe('lib/asset/tags', () => {
  describe('decodeTags', () => {
    it('returns [] for null/empty/missing', () => {
      expect(decodeTags(null)).toEqual([]);
      expect(decodeTags(undefined)).toEqual([]);
      expect(decodeTags('')).toEqual([]);
    });

    it('decodes a JSON array of strings, trimming and de-duplicating', () => {
      expect(decodeTags('[" foo ", "bar", "foo", "  "]')).toEqual(['foo', 'bar']);
    });

    it('returns [] for malformed JSON or non-array payloads (defensive)', () => {
      expect(decodeTags('not-json')).toEqual([]);
      expect(decodeTags('{"a":1}')).toEqual([]);
      expect(decodeTags('"foo"')).toEqual([]);
    });

    it('drops non-string entries silently', () => {
      expect(decodeTags('["a", 1, true, null, "b"]')).toEqual(['a', 'b']);
    });
  });

  describe('encodeTags', () => {
    it('round-trips through decodeTags', () => {
      const tags = ['hero', 'brand', 'q1'];
      expect(decodeTags(encodeTags(tags))).toEqual(tags);
    });
  });

  describe('normalizeTags', () => {
    it('rejects non-array input', () => {
      expect(() => normalizeTags('foo')).toThrow(TagsValidationError);
      expect(() => normalizeTags(null)).toThrow(TagsValidationError);
      expect(() => normalizeTags({ 0: 'x' })).toThrow(TagsValidationError);
    });

    it('rejects non-string entries', () => {
      expect(() => normalizeTags(['ok', 123])).toThrow(TagsValidationError);
    });

    it('trims, drops empties, de-duplicates, preserves first occurrence', () => {
      expect(normalizeTags([' a ', 'b', 'a', ' ', 'B'])).toEqual(['a', 'b', 'B']);
    });

    it('enforces per-tag length cap', () => {
      const long = 'x'.repeat(MAX_TAG_LENGTH + 1);
      expect(() => normalizeTags([long])).toThrow(TagsValidationError);
    });

    it('enforces total count cap', () => {
      const many = Array.from({ length: MAX_TAGS_PER_ASSET + 1 }, (_, i) => `t${i}`);
      expect(() => normalizeTags(many)).toThrow(TagsValidationError);
    });

    it('accepts empty array (clear tags)', () => {
      expect(normalizeTags([])).toEqual([]);
    });
  });

  describe('normalizeFolder', () => {
    it('treats null/undefined/empty as null', () => {
      expect(normalizeFolder(null)).toBeNull();
      expect(normalizeFolder(undefined)).toBeNull();
      expect(normalizeFolder('')).toBeNull();
      expect(normalizeFolder('   ')).toBeNull();
    });

    it('trims valid folder name', () => {
      expect(normalizeFolder('  Brand  ')).toBe('Brand');
    });

    it('rejects non-string', () => {
      expect(() => normalizeFolder(123)).toThrow(TagsValidationError);
    });

    it('rejects path separator', () => {
      expect(() => normalizeFolder('a/b')).toThrow(TagsValidationError);
    });

    it('rejects too-long folder names', () => {
      expect(() => normalizeFolder('x'.repeat(65))).toThrow(TagsValidationError);
    });
  });
});
