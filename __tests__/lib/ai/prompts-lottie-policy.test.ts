/**
 * TM-145 / ADR-0027 §2 — Lottie catalogue prompt policy.
 *
 * The closed slug enum (`LOTTIE_CATALOG_SLUGS`) is interpolated verbatim
 * into `GENERATION_SYSTEM_PROMPT` so the LLM emits one of the curated
 * deterministic catalogue assets via `<CatalogueLottie asset="...">`
 * instead of inventing animation JSON (which the sandbox denies — see
 * sandbox.ts `<Lottie>` deny rule and ADR-0027 §1).
 *
 * Regressions this test catches:
 *   1. Slug list silently drops an entry when the catalogue is extended
 *      and someone forgets to widen the prompt enum.
 *   2. The wrapper component reference (`<CatalogueLottie>`) gets
 *      renamed without prompt + sandbox updates.
 *   3. The Korean keyword hints (TM-145 — needed because most prompts
 *      arrive in Korean) get scrubbed by an unrelated prompt cleanup.
 *   4. Audio policy (TM-129) and CHARACTER policy (TM-137) regress
 *      because the Lottie insertion accidentally clobbered them.
 *   5. `GENERATION_WITH_CLARIFY_SYSTEM_PROMPT` loses the Lottie
 *      catalogue (it concatenates GENERATION_SYSTEM_PROMPT, so the
 *      check is structural — but a future refactor that splits the two
 *      should be caught here).
 *
 * ADR-0003 (prompt caching) — adding catalogue content to the system
 * prompt invalidates the ephemeral cache key on first edit; that is
 * INTENTIONAL. Stale caches would keep recommending only the old subset.
 */
import {
  GENERATION_SYSTEM_PROMPT,
  GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
} from '@/lib/ai/prompts';
import { LOTTIE_CATALOG_SLUGS } from '@/lib/lottie/manifest-types';

describe('GENERATION_SYSTEM_PROMPT — TM-145 Lottie catalogue policy', () => {
  it('declares the LOTTIE CATALOGUE POLICY section', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/LOTTIE CATALOGUE POLICY/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/ADR-0027/);
  });

  it('teaches the <CatalogueLottie> wrapper is the only accepted shape', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/<CatalogueLottie\b/);
    // The bare <Lottie> denial must be explicit.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/bare\s+`?<Lottie>`?\s+(tag\s+)?is\s+REJECTED/i);
  });

  it('lists every LOTTIE_CATALOG_SLUGS entry verbatim', () => {
    for (const slug of LOTTIE_CATALOG_SLUGS) {
      expect(GENERATION_SYSTEM_PROMPT).toContain(slug);
    }
  });

  it('preserves Korean keyword → slug hints for the most common subjects', () => {
    // Sample of the hints we promised to ship in Phase B.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/곰/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/강아지/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/고양이/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/사람/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/새/);
  });

  it('encodes the Lottie-vs-imageGen decision rule (Lottie preferred when both possible)', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/PREFER the Lottie catalogue/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/deterministic/i);
    // Out-of-catalogue fallback path remains documented.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/dragon|dinosaur|outside the\s+catalogue/i);
  });

  it('uses lottieAsset PARAMS type comment so the picker can swap at runtime (TM-146)', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/type:\s*lottieAsset/);
  });

  it('declares CatalogueLottie in the Remotion globals list', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/CatalogueLottie\s*\(TM-140/);
  });

  it('CHARACTER section now points at the Lottie catalogue first', () => {
    // Anchor on the CHARACTER block header so we know the cross-reference
    // is in the right place.
    const charIdx = GENERATION_SYSTEM_PROMPT.indexOf('[CHARACTER');
    expect(charIdx).toBeGreaterThan(-1);
    const tail = GENERATION_SYSTEM_PROMPT.slice(charIdx, charIdx + 800);
    expect(tail).toMatch(/CatalogueLottie/);
    expect(tail).toMatch(/prefer/i);
  });

  it('preserves TM-129 audio catalogue policy (regression guard)', () => {
    // The Lottie insertion must not have wiped the audio block.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/staticFile\(\s*['"]audio\//);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/CatalogueAudio/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/bgmTrack/);
  });

  it('preserves TM-137 character / scene-depth policy (regression guard)', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/3-layer composition/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/Walk-cycle keyframes/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/anti-phase/);
  });

  it('GENERATION_WITH_CLARIFY_SYSTEM_PROMPT inherits the Lottie policy', () => {
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/LOTTIE CATALOGUE POLICY/);
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/<CatalogueLottie\b/);
    for (const slug of LOTTIE_CATALOG_SLUGS) {
      expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toContain(slug);
    }
  });
});
