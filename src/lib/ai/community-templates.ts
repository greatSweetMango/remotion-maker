/**
 * TM-141 — Community-style reference RAG (public facade).
 *
 * Background:
 *   TM-74 introduced single-template RAG using our own 35 production
 *   templates as exemplars. TM-46 r6/r7 ablation confirmed RAG-ON lifts
 *   visual quality on chart/transition prompts but left blind spots:
 *   character/entity prompts (TM-95), hello-world style intros, captions,
 *   audiogram, parallax depth ("Apple Wow"), 3-D, and stock/finance.
 *   We ship hand-authored MINIMAL PATTERN snippets (original work, safe to
 *   distribute) that demonstrate the canonical structure of each category.
 *
 * Integration: `retrieveReferenceForPrompt` (in `retrieval.ts`) calls
 * `pickCommunityReferenceForPrompt` after the primary keyword/category
 * match. When a community signal hits, the snippet is appended to the primary
 * reference block as a SECONDARY exemplar with an "ALTERNATIVE PATTERN" label.
 *
 * TM-183 (2026-06-04): the original 650-LOC module was split for cohesion —
 *   - snippet string constants → `./community-snippets`
 *   - types + `COMMUNITY_REFERENCES` catalog → `./community-catalog`
 *   - picking/building logic → this file (the stable public entrypoint).
 * Importers keep using `@/lib/ai/community-templates`; the catalog and types
 * are re-exported below so the public surface is unchanged.
 * See `wiki/05-reports/2026-06-04-refactor-week-3-lib-cohesion.md`.
 */

import {
  COMMUNITY_REFERENCES,
  type CommunityCategory,
  type CommunityReference,
} from './community-catalog';

export { COMMUNITY_REFERENCES };
export type { CommunityCategory, CommunityReference };

/**
 * Match a community reference against a free-form prompt.
 *
 * Strategy: for each catalog entry, count how many of its keywords appear in
 * the lowercased prompt. Pick the entry with the highest non-zero score.
 * Returns null when no entry scores > 0 — caller should skip community
 * augmentation rather than guessing.
 *
 * Deterministic tiebreak: when multiple entries tie, return the FIRST one
 * registered. This keeps prompt-cache keys stable across runs (ADR-0003).
 */
export function pickCommunityReferenceForPrompt(
  prompt: string,
  catalog: CommunityReference[] = COMMUNITY_REFERENCES,
): CommunityReference | null {
  const p = prompt.toLowerCase();
  let best: CommunityReference | null = null;
  let bestScore = 0;
  for (const c of catalog) {
    let score = 0;
    for (const kw of c.keywords) {
      // word-boundary-ish match for short tokens to avoid e.g. "cat" matching
      // "category". For multi-word keywords (with a space) we just substring.
      if (kw.includes(' ')) {
        if (p.includes(kw)) score += 1;
      } else if (/^[a-z0-9-]+$/.test(kw)) {
        const re = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, 'i');
        if (re.test(p)) score += 1;
      } else {
        // Korean / non-ASCII — substring is fine; KO has no word boundaries.
        if (p.includes(kw)) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Build a secondary "ALTERNATIVE PATTERN" addendum from a matched community
 * reference. Designed to be appended after the primary TM-74 reference block
 * in `retrieval.ts`. Returns '' when no community match — safe to concat.
 */
export function buildCommunityReferenceBlock(prompt: string): string {
  const ref = pickCommunityReferenceForPrompt(prompt);
  if (!ref) return '';

  const MAX_REF_CHARS = 4500; // smaller than primary; this is supplementary.
  const src =
    ref.source.length > MAX_REF_CHARS
      ? ref.source.slice(0, MAX_REF_CHARS) + '\n// ... (truncated)'
      : ref.source;

  return `

============== ALTERNATIVE PATTERN (RAG community, TM-141) ==============

The prompt also matched a community-style pattern for "${ref.category}".
${ref.whenToUse}

This is a SECONDARY exemplar — the primary reference above remains your
main structural guide. Borrow only what's relevant from the snippet below
(layering, motion, layout) and adapt to the user's actual subject.

Reference id: ${ref.id}
Reference category: ${ref.category}

\`\`\`tsx
${src}
\`\`\`

============== END ALTERNATIVE PATTERN ==============
`;
}
