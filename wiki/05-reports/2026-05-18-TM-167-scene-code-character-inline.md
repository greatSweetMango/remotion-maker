---
title: TM-167 — Inline CHARACTER guidelines into SCENE_CODE_SYSTEM_PROMPT
created: 2026-05-18
updated: 2026-05-18
tags: [report, session, asset-gen, prompts, multi-step, tm-167, tm-166]
status: active
report_type: session
provenance: extracted
---

# TM-167 — Inline CHARACTER guidelines into SCENE_CODE_SYSTEM_PROMPT

> Root-cause #1 from `[[2026-05-18-TM-166-composition-rca|TM-166 RCA]]`: the multi-step path's
> `SCENE_CODE_SYSTEM_PROMPT` was missing the CHARACTER/SCENE/NARRATIVE rules that the
> single-shot `GENERATION_SYSTEM_PROMPT` carries (added in TM-137 / PR #182). Closing that
> propagation gap deterministically eliminates the "곰돌이 산책" failure class — a perfectly
> good asset-gen PNG mangled by a purple band and pink lucide flowers bolted on top.

## What changed

| File | Change |
|---|---|
| `src/lib/ai/prompts.ts:736-869` | Appended a CHARACTER / SCENE / NARRATIVE block (~130 lines) to `SCENE_CODE_SYSTEM_PROMPT`. Sections A (imageUrl-bearing scenes — TM-166 fix), B (no-imageUrl living entities), C (palette), D (composition / rule of thirds), E (shared anti-patterns). Preserves original RULES 1–5 verbatim. |
| `src/lib/ai/pipeline.ts:714-724` | Strengthened the TM-90 imageUrl addendum to *redirect* to section A (instead of restating a loose `objectFit: 'contain'` hint). New addendum mandates `PARAMS.imageUrl` reference (forbids bare identifier), `objectFit: 'cover'` (forbids `contain`), and exposes `imageUrl` in the scene's PARAMS block so destructured-prop defaults reach the JSX. |
| `__tests__/lib/ai/prompts-scene-code-character.test.ts` | New unit test (16 cases) — guards: original RULES preserved; CHARACTER header present; section A imageUrl rules (FULL scene, `objectFit:'cover'`, `PARAMS.imageUrl` ref, no opaque overlays, no lucide decoration, no vector character, anti-patterns by name); section B no-imageUrl rules (3-layer, separated limbs, walk-cycle anti-phase, no translateX-only, CatalogueLottie pref); shared rules (3 colors, rule of thirds, anti-patterns). |

## Section A — imageUrl-bearing scenes (the actual TM-166 fix)

Direct mapping to the TM-166 forensic teardown:

| TM-166 failure | Rule inlined |
|---|---|
| `<Img top=340 …` no width/height → 60% bare navy | `<Img style={{ width:'100%', height:'100%', objectFit:'cover' }} />` is REQUIRED full-bleed |
| Hard-coded URL string in Scene1 (uneditable) | "NEVER hard-code the URL string — it must stay PARAMS-bound" |
| `<Img src={imageUrl}>` bare identifier in Scene2 → ReferenceError | "NEVER write a bare `imageUrl` identifier" + addendum mandates exposing `imageUrl` in scene PARAMS |
| Purple `<div>` band at `top=800 bg=#7C3AED` over PNG | "NO full-width solid `<div>` bands. NO opaque colored rectangles" — anti-pattern: "Opaque `<AbsoluteFill>` or solid `<div>` placed AFTER the `<Img>` in DOM order" |
| 3× `<lucide.Flower>` decoration on top of PNG | "NO `<lucide.X>` decoration (flowers, stars, hearts) on top of the PNG — the PNG already contains its own decoration" |
| Full-screen pink overlay opacity 0.5 in Scene2 | Anti-pattern: "Full-frame colored overlay … at non-zero opacity above the PNG" |
| Vector character drawn over PNG | "NO vector character drawn ON TOP of the PNG — the PNG already contains the character" |

Motion guidance now explicitly tells the model:
- Motion = transforms/opacity on a SIBLING transparent layer above the Img, OR on the Img wrapper itself (scale, translateX for parallax).
- Camera-style horizontal scroll (the "Mario-style" the user requested in edit-2) = `translateX` on a wrapper around the `<Img>`, NOT a sprite over a static background. This addresses "곰돌이가 움직이지 않고" complaint.

The 3-layer depth + separated-limbs + walk-cycle rules are scoped to section B (no-imageUrl case only) so the model does not double-apply them on top of a PNG that already contains its own background/midground/foreground.

## Verification

- `npx jest __tests__/lib/ai/prompts-scene-code-character.test.ts` → **16/16 pass**.
- `npx jest __tests__/lib/ai/` → **425 pass / 6 skip / 0 fail** (zero regression in TM-129 audio, TM-137 character, TM-145 lottie, TM-71 categories, etc.).
- Unrelated suite failures (`__tests__/scripts/fixtures/*`, `__tests__/visual-regression/*`, `denylist-sync`, `evaluator`, `customize-roundtrip`, `player-playback-rate`, etc.) reproduce on `HEAD~1` (verified via `git stash` round-trip) — pre-existing infra failures, NOT caused by this change.

Live verification with the user's "곰돌이의 초원 산책" prompt was NOT run in this session (multi-step pipeline live calls cost LLM + asset-gen tokens; deferring to the next QA cycle or to TM-149 corpus expansion).

## ADR-0003 cache-invalidation note

This patch modifies the body of `SCENE_CODE_SYSTEM_PROMPT`, which is part of the cached system prompt key for the multi-step scene-code stage. **The next scene-code call after deploy will force a fresh `cache_control: ephemeral` write** (cost: one full prompt write, ~500 tokens uncached, ~$0.0008 on Haiku); subsequent calls re-hit cache normally. The pipeline addendum's text also changed but is appended at runtime per-asset (varies with `imageUrl` presence) — that branch was already cache-volatile, so no incremental impact.

## What this does NOT do (deferred follow-ups, see TM-166 RCA §5)

| # | Title | Why deferred |
|---|---|---|
| 3 | AST validator: reject scene with `<Img>` + later sibling `<div>`/`<AbsoluteFill>` opaque overlay | Out of scope — separate task, needs `src/lib/code/composition-lint.ts` + integration into `validateCode` |
| 4 | Validator: `<Img src={…}>` must reference literal / `PARAMS.imageUrl` / destructured prop | Out of scope — separate task in `src/lib/code/sandbox.ts` |
| 5 | Composition judge: render asset to 1 frame and feed `judgeVisual` | Out of scope — new infra |
| 6 | Spec↔asset-gen handshake (tell `SCENE_SPEC_SYSTEM_PROMPT` "the PNG already has flowers/ground") | Adjacent — should land as TM-168 |
| 8 | Asset-preview regression corpus for character-scene prompts | TM-149 expansion |
| 9 | Edit-path FULL_REGEN escape hatch on "다시 만들어 / 처음부터" verbs | Separate task — edit path, not scene-code |

This PR handles **prompt #1 + #2** from the RCA recommended-first-wave; #3/#4 are deterministic validators to land next.

## Cross-references

- `[[2026-05-18-TM-166-composition-rca|TM-166 RCA]]` — root cause analysis that spawned this task
- `[[01-pm/decisions/0003-prompt-caching-on-edit|ADR-0003]]` — cache invalidation policy honored above
- `[[01-pm/decisions/0022-asset-gen-image-url|ADR-0022]]` — `imageUrl` PARAMS surface contract enforced by section A
- TM-137 / PR #182 — the original CHARACTER block in `GENERATION_SYSTEM_PROMPT` that section A/B/C/D/E adapts and propagates here
- TM-90 / TM-136 — `imageUrl` injection (consumer of the new rules)
- TM-116 `__SceneBoundary` — masked Scene2 crash in TM-166; section A removes the upstream cause
