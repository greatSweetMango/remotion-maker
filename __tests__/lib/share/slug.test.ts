import { generatePublicSlug } from '@/lib/share/slug';

describe('generatePublicSlug', () => {
  it('returns a non-empty string', () => {
    const slug = generatePublicSlug();
    expect(typeof slug).toBe('string');
    expect(slug.length).toBeGreaterThan(0);
  });

  it('encodes 9 random bytes as base64url (12 chars, URL-safe)', () => {
    const slug = generatePublicSlug();
    expect(slug).toHaveLength(12);
    // base64url alphabet: A-Z a-z 0-9 - _ (no padding)
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique slugs across many calls (collision probability ~0)', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 1000; i++) samples.add(generatePublicSlug());
    expect(samples.size).toBe(1000);
  });
});
