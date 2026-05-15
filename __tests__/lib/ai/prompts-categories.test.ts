/**
 * TM-71 — visual-quality prompt-level pass.
 *
 * Verifies that GENERATION_SYSTEM_PROMPT carries explicit category guidelines
 * for the categories that under-performed in TM-46 r3 (data-viz, transition,
 * text-anim) so the LLM cannot omit them. If a future refactor drops the
 * "CATEGORY-SPECIFIC GUIDELINES" block this test goes red.
 */
import {
  GENERATION_SYSTEM_PROMPT,
  GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
} from '@/lib/ai/prompts';

describe('GENERATION_SYSTEM_PROMPT — TM-71 category guidelines', () => {
  it('contains a CATEGORY-SPECIFIC GUIDELINES block', () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain('CATEGORY-SPECIFIC GUIDELINES');
  });

  it('reinforces data-viz: axes, labels, value rendering, palette', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[DATA-VIZ/);
    // explicit data-rendering rule
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/every value MUST be visible/i);
    // labels / axes
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/percentage label/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/x-axis/i);
    // palette hint respected
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/palette hint/i);
  });

  it('reinforces transitions: two-state requirement + interpolation', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[TRANSITION/);
    // two states must be visible
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/"before"/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/"after"/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/midpoint frame/i);
    // concrete techniques
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/clip-path/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/RGB-split/i);
  });

  it('reinforces text-anim: legibility first, motion as modifier', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[TEXT-ANIM/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/Typography first/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/MODIFIER, not the subject/i);
  });

  it('GENERATION_WITH_CLARIFY_SYSTEM_PROMPT inherits the guidelines', () => {
    // The clarify variant concatenates GENERATION_SYSTEM_PROMPT, so the same
    // category block must reach the model in clarify mode too.
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toContain(
      'CATEGORY-SPECIFIC GUIDELINES'
    );
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/\[DATA-VIZ/);
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/\[TRANSITION/);
  });

  // TM-137: CHARACTER / SCENE / NARRATIVE category — addresses the
  // "곰돌이 → 갈색 원" regression captured in TM-135 RCA. The system
  // prompt previously had zero character-specific guidance; this test
  // ensures the new block stays in place across refactors.
  describe('TM-137 — CHARACTER / SCENE guidelines', () => {
    it('contains a CHARACTER / SCENE / NARRATIVE category header', () => {
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[CHARACTER \/ SCENE/);
    });

    it('forbids the single-shape placeholder failure mode', () => {
      // The "single circle / square / pill" anti-pattern is the exact
      // TM-135 regression — must be called out by name.
      expect(GENERATION_SYSTEM_PROMPT).toMatch(
        /single (?:`?<div>`? )?circle|circle.*placeholder/i
      );
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/anti-pattern|FAILURE/i);
    });

    it('mandates 3-layer scene depth (foreground / midground / background)', () => {
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/foreground/i);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/midground/i);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/background/i);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/parallax/i);
    });

    it('mandates separated limbs + face features for living entities', () => {
      // head + body + ≥2 limbs + face features is the structural minimum.
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/separated limbs|distinct moving parts/i);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/limbs/i);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/face features|eyes/i);
    });

    it('teaches the walk-cycle keyframe pattern (anti-phase legs + body bob)', () => {
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/walk[- ]cycle/i);
      // anti-phase oscillation for legs (Math.PI offset)
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/Math\.PI|anti-phase/);
      // sine-driven motion
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/Math\.sin/);
      // explicit bob
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/bob/i);
    });

    it('forbids translateX-only motion as a walking implementation', () => {
      expect(GENERATION_SYSTEM_PROMPT).toMatch(
        /translateX[- ]only|pure `?translateX`?/i
      );
    });

    it('mandates >=3 distinct colors honoring the user tone hint', () => {
      expect(GENERATION_SYSTEM_PROMPT).toMatch(
        /THREE distinct colors|≥\s*3\s*colors|three colors/i
      );
    });

    it('mentions the asset-gen <Img src={imageUrl} /> hand-off (ADR-0022)', () => {
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/imageUrl/);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/<Img\b/);
    });

    it('clarify variant inherits the CHARACTER block', () => {
      expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/\[CHARACTER \/ SCENE/);
      expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/walk[- ]cycle/i);
    });

    it('does NOT regress existing motion-graphics categories', () => {
      // Sanity guard — adding the CHARACTER block must not displace the
      // TM-71 categories the LLM relies on for non-character prompts.
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[DATA-VIZ/);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[TRANSITION/);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[TEXT-ANIM/);
      expect(GENERATION_SYSTEM_PROMPT).toMatch(/\[INFOGRAPHIC \/ LOADER\]/);
    });
  });
});
