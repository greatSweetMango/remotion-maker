import { extractParameters } from '@/lib/ai/extract-params';
import { sanitizeCode } from '@/lib/remotion/sandbox';
import { searchLucideCatalog, LUCIDE_CATALOG, DEFAULT_LUCIDE_ICON } from '@/lib/lucide-catalog';

describe('TM-22 — lucide icon support', () => {
  describe('extractParameters', () => {
    it('parses `// type: icon` as a string-valued parameter', () => {
      const code = `
const PARAMS = {
  icon: "Heart", // type: icon
} as const;
`;
      const params = extractParameters(code);
      expect(params).toHaveLength(1);
      expect(params[0].type).toBe('icon');
      expect(params[0].value).toBe('Heart');
      // icon doesn't fall into color/timing/size/text — should land in 'other'
      expect(params[0].group).toBe('other');
    });
  });

  describe('sandbox.sanitizeCode', () => {
    it('strips `import ... from "lucide-react"` lines', () => {
      const before = `import { Heart } from 'lucide-react';\nconst x = 1;`;
      const after = sanitizeCode(before);
      expect(after).not.toMatch(/lucide-react/);
      expect(after).toMatch(/const x = 1/);
    });

    it('also strips double-quoted lucide-react imports', () => {
      const before = `import { Star, Trophy } from "lucide-react";\nconst y = 2;`;
      const after = sanitizeCode(before);
      expect(after).not.toMatch(/lucide-react/);
    });
  });

  describe('lucide-catalog', () => {
    it('exposes ~50 popular icons', () => {
      expect(LUCIDE_CATALOG.length).toBeGreaterThanOrEqual(50);
    });

    it('default icon is in the catalog', () => {
      expect(LUCIDE_CATALOG.some(e => e.name === DEFAULT_LUCIDE_ICON)).toBe(true);
    });

    it('search by name (case-insensitive)', () => {
      expect(searchLucideCatalog('heart').some(e => e.name === 'Heart')).toBe(true);
      expect(searchLucideCatalog('HEART').some(e => e.name === 'Heart')).toBe(true);
    });

    it('search by tag', () => {
      const results = searchLucideCatalog('love');
      expect(results.some(e => e.name === 'Heart')).toBe(true);
    });

    it('empty query returns full catalog', () => {
      expect(searchLucideCatalog('').length).toBe(LUCIDE_CATALOG.length);
      expect(searchLucideCatalog('   ').length).toBe(LUCIDE_CATALOG.length);
    });

    it('catalog uses Lucide v1 names (House not Home)', () => {
      expect(LUCIDE_CATALOG.some(e => e.name === 'House')).toBe(true);
      expect(LUCIDE_CATALOG.some(e => e.name === 'Home')).toBe(false);
    });
  });
});
