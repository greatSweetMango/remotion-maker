/**
 * TM-167 — SCENE_CODE_SYSTEM_PROMPT must carry the CHARACTER / SCENE /
 * NARRATIVE composition rules.
 *
 * TM-137 added these rules to the single-shot GENERATION_SYSTEM_PROMPT
 * but the multi-step SCENE_CODE_SYSTEM_PROMPT was missed — root cause
 * of the TM-166 "곰돌이 산책" composition failure (asset-gen PNG with
 * a purple band and pink lucide flowers bolted on top). This test
 * guards against regression.
 */
import { SCENE_CODE_SYSTEM_PROMPT } from '@/lib/ai/prompts';

describe('SCENE_CODE_SYSTEM_PROMPT — TM-167 CHARACTER block', () => {
  it('preserves the original RULES 1-5 (fragment shape, locality, JSON)', () => {
    expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/Output a TSX FRAGMENT/);
    expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/Scene\{N\}Params/);
    expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/useCurrentFrame\(\)/);
    expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(
      /Respond strictly in JSON/,
    );
  });

  it('contains a CHARACTER / SCENE / NARRATIVE header', () => {
    expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/\[CHARACTER \/ SCENE/);
    expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/TM-167/);
  });

  describe('imageUrl-bearing scenes (section A — TM-166 fix)', () => {
    it('declares the PNG is the FULL scene, not a sprite', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/PNG is the FULL scene/);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/not a sprite|NOT a sprite/i);
    });

    it("mandates objectFit: 'cover' for full-bleed Img", () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/objectFit:\s*['"]cover['"]/);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/full-?bleed/i);
    });

    it('requires PARAMS.imageUrl reference (not bare imageUrl, not literal URL)', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/PARAMS\.imageUrl/);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(
        /bare `?imageUrl`?|NEVER write a bare/i,
      );
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/NEVER hard-code/i);
    });

    it('forbids opaque AbsoluteFill / solid div bands / lucide decoration above the PNG', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/NO full-width solid/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/NO\s+`?<lucide\.X>`?\s+decoration/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/NO vector character/i);
    });

    it('teaches motion = sibling transparent layer / Img wrapper transforms', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(
        /sibling transparent layer|transforms\/opacity/i,
      );
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/camera|parallax/i);
    });

    it('lists TM-166 anti-patterns by name', () => {
      // explicit bare imageUrl ReferenceError
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/ReferenceError/);
      // hard-coded URL break customize swap
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/hard-coded literal URL/);
      // lucide.Flower over PNG anti-pattern
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/<lucide\.Flower>/);
    });
  });

  describe('no-imageUrl scenes (section B)', () => {
    it('mandates 3-layer scene depth + parallax', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/3-layer scene depth/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/background/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/midground/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/foreground/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/parallax/i);
    });

    it('mandates separated limbs + face features', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/separated limbs/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/face features|eyes/i);
    });

    it('teaches the walk-cycle anti-phase + bob pattern', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/walk-cycle/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/anti-phase/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/Math\.PI/);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/Math\.sin/);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/bob/i);
    });

    it('forbids translateX-only motion', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/translateX`?[- ]only/i);
    });

    it('points to CatalogueLottie as preferred when slug exists', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/CatalogueLottie/);
    });
  });

  describe('shared rules (sections C, D, E)', () => {
    it('mandates >=3 distinct colors with tone hint honored', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(
        /THREE distinct colors|three colors|≥\s*3\s*colors/i,
      );
    });

    it('mandates rule-of-thirds composition (1/4 - 1/3 height)', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/rule of thirds/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/1\/4|1\/3/);
    });

    it('lists shared anti-patterns (single shape, flat layer, monochrome)', () => {
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(
        /Single .*circle .*square .*pill/i,
      );
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/Flat one-layer scene/i);
      expect(SCENE_CODE_SYSTEM_PROMPT).toMatch(/Monochrome scene/i);
    });
  });
});
