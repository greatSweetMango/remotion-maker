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
});
