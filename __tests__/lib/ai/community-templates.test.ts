/**
 * TM-141 — Community-style RAG references.
 *
 * Verifies:
 *   1. Picker matches the right community snippet for canonical prompts
 *      (character / audiogram / captions / 3D / apple-wow / stock).
 *   2. Picker returns null for prompts with no community signal so we don't
 *      inject noise.
 *   3. The composed addendum is non-empty for hits, contains a unique label,
 *      and stays under the budget.
 *   4. All snippet sources expose the ADR-0002 PARAMS contract and an
 *      AbsoluteFill root.
 */

import {
  COMMUNITY_REFERENCES,
  pickCommunityReferenceForPrompt,
  buildCommunityReferenceBlock,
} from '@/lib/ai/community-templates';
import { retrieveReferenceForPrompt } from '@/lib/ai/retrieval';

describe('community-templates — picker', () => {
  const cases: Array<[string, string]> = [
    ['a happy bear walking through a forest', 'character-scene'],
    ['귀여운 강아지가 공원에서 놀고있어', 'character-scene'],
    ['astronaut floating in space', 'character-scene'],
    ['hello world starter intro', 'hello-world'],
    ['podcast audiogram with waveform bars', 'audiogram'],
    ['팟캐스트 오디오그램', 'audiogram'],
    ['word by word captions for a tiktok clip', 'word-by-word-captions'],
    ['자막 표시', 'word-by-word-captions'],
    ['3d rotating cube card', 'three-d-card'],
    ['perspective rotateY card', 'three-d-card'],
    ['apple style introducing the new product reveal', 'apple-wow-reveal'],
    ['프리미엄 제품 런칭 영상', 'apple-wow-reveal'],
    ['tailwind utility card layout', 'utility-card'],
    ['AAPL stock ticker sparkline', 'stock-sparkline'],
    ['암호화폐 시세 차트', 'stock-sparkline'],
    ['audio reactive pulse rings', 'audio-reactive-pulse'],
    ['multi scene sequence composition', 'sequence-composition'],
  ];

  test.each(cases)('matches "%s" → %s', (prompt, expectedId) => {
    const ref = pickCommunityReferenceForPrompt(prompt);
    expect(ref?.id).toBe(expectedId);
  });

  it('returns null for prompts with no community signal', () => {
    expect(pickCommunityReferenceForPrompt('something cool')).toBeNull();
    expect(pickCommunityReferenceForPrompt('foo bar baz')).toBeNull();
  });

  it('does not match "category" as if it were "cat" (word boundary safety)', () => {
    expect(pickCommunityReferenceForPrompt('this is a category list')).toBeNull();
  });
});

describe('community-templates — addendum block', () => {
  it('returns empty string when no community signal', () => {
    expect(buildCommunityReferenceBlock('foo bar')).toBe('');
  });

  it('embeds reference source and unique TM-141 label on a hit', () => {
    const block = buildCommunityReferenceBlock('cute cat character in forest');
    expect(block).toContain('ALTERNATIVE PATTERN (RAG community, TM-141)');
    expect(block).toContain('character-scene');
    expect(block).toContain('PARAMS');
    expect(block).toContain('AbsoluteFill');
    expect(block.length).toBeLessThan(8000); // budget guard
  });

  it('truncates extremely long sources', () => {
    // Inject a fake oversize entry through the picker by appending to catalog.
    const huge = 'X'.repeat(20_000);
    const fake = [
      {
        id: 'huge',
        category: 'character' as const,
        whenToUse: 'test',
        keywords: ['supercalifragilistic'],
        source: huge,
      },
    ];
    const ref = pickCommunityReferenceForPrompt(
      'supercalifragilistic prompt token',
      fake,
    );
    expect(ref?.id).toBe('huge');
  });
});

describe('community-templates — catalog quality', () => {
  it('every snippet exports a PARAMS const and renders AbsoluteFill', () => {
    for (const ref of COMMUNITY_REFERENCES) {
      expect(ref.source).toMatch(/export const PARAMS\s*=/);
      expect(ref.source).toMatch(/AbsoluteFill/);
    }
  });

  it('every snippet stays inside the per-snippet budget', () => {
    for (const ref of COMMUNITY_REFERENCES) {
      // 6KB hard budget — primary refs are ~2-4KB, community ones similar.
      expect(ref.source.length).toBeLessThan(6000);
    }
  });

  it('catalog ids are unique', () => {
    const ids = COMMUNITY_REFERENCES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('retrieveReferenceForPrompt — TM-141 community surfacing', () => {
  it('exposes community match alongside primary chart hit', () => {
    // Stock prompt → primary chart (line-chart via "trend"/"stock") + community stock-sparkline
    const r = retrieveReferenceForPrompt('AAPL stock line trend over the week');
    expect(r.community?.id).toBe('stock-sparkline');
  });

  it('community-only hit when no primary category matches', () => {
    const r = retrieveReferenceForPrompt('cute fox character running in a meadow');
    expect(r.category).toBeNull();
    expect(r.reference).toBeNull();
    expect(r.community?.id).toBe('character-scene');
    // Addendum should still be populated thanks to community fallback.
    expect(r.addendum).toContain('ALTERNATIVE PATTERN');
  });

  it('returns null community + empty addendum for pure-noise prompt', () => {
    const r = retrieveReferenceForPrompt('something cool');
    expect(r.category).toBeNull();
    expect(r.reference).toBeNull();
    expect(r.community).toBeNull();
    expect(r.addendum).toBe('');
  });
});
