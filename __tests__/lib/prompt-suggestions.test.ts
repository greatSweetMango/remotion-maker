import {
  PROMPT_SUGGESTIONS,
  PROMPT_SUGGESTION_CATEGORIES,
  CATEGORY_LABELS,
  pickDiversifiedSuggestions,
} from '@/lib/prompt-suggestions';

describe('PROMPT_SUGGESTIONS catalog', () => {
  it('exposes at least 50 suggestions', () => {
    expect(PROMPT_SUGGESTIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('every suggestion has a non-empty id, label, prompt and a known category', () => {
    for (const s of PROMPT_SUGGESTIONS) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.prompt.length).toBeGreaterThan(10);
      expect(PROMPT_SUGGESTION_CATEGORIES).toContain(s.category);
    }
  });

  it('ids are unique', () => {
    const ids = PROMPT_SUGGESTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every category has at least 5 entries (so diversification can pick one each)', () => {
    for (const cat of PROMPT_SUGGESTION_CATEGORIES) {
      const entries = PROMPT_SUGGESTIONS.filter((s) => s.category === cat);
      expect(entries.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('exposes a label for every category', () => {
    for (const cat of PROMPT_SUGGESTION_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});

describe('pickDiversifiedSuggestions', () => {
  it('returns the requested count when pool is large enough', () => {
    expect(pickDiversifiedSuggestions(4, 1).length).toBe(4);
    expect(pickDiversifiedSuggestions(5, 1).length).toBe(5);
  });

  it('returns no duplicates', () => {
    const picks = pickDiversifiedSuggestions(5, 42);
    const ids = picks.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('diversifies categories when count <= number of categories', () => {
    const picks = pickDiversifiedSuggestions(5, 7);
    const cats = picks.map((p) => p.category);
    expect(new Set(cats).size).toBe(5); // one from each
  });

  it('is deterministic for the same seed', () => {
    const a = pickDiversifiedSuggestions(4, 12345).map((p) => p.id);
    const b = pickDiversifiedSuggestions(4, 12345).map((p) => p.id);
    expect(a).toEqual(b);
  });

  it('produces different orderings for different seeds (smoke check)', () => {
    const a = pickDiversifiedSuggestions(4, 1).map((p) => p.id).join(',');
    const b = pickDiversifiedSuggestions(4, 999).map((p) => p.id).join(',');
    // Not strictly guaranteed, but with 50+ items it should hold.
    expect(a).not.toEqual(b);
  });

  it('handles count larger than categories by cycling', () => {
    const picks = pickDiversifiedSuggestions(8, 3);
    expect(picks.length).toBe(8);
    expect(new Set(picks.map((p) => p.id)).size).toBe(8);
  });

  it('returns empty array for count <= 0', () => {
    expect(pickDiversifiedSuggestions(0, 1)).toEqual([]);
    expect(pickDiversifiedSuggestions(-3, 1)).toEqual([]);
  });
});
