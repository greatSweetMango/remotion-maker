---
title: ADR-0020 Multi-step generation pipeline (outline → scene → code)
status: accepted
date: 2026-04-27
tags:
  - "#adr"
  - "#ai/generate"
  - "#tm-102"
related:
  - "[[0019-rag-templates]]"
  - "[[0017-capture-determinism]]"
  - "[[0003-prompt-caching]]"
---

# ADR-0020: Multi-step generation pipeline

> NNNN will be assigned at PR-time (next free number on origin/main).

## Context

User feedback on `generateAsset`'s single-shot LLM call: "결과물이 너무 부실.
Claude artifact 수준이어야". Single-call generation forces the model to
simultaneously decide on (a) the **narrative shape** of the asset, (b) the
**visual design** of each beat, and (c) the **executable Remotion code** —
so it usually rushes (b) and produces thin scenes that lack labels, palette
discipline, or per-section motion. TM-71 (category guidelines) and TM-74
(reference RAG) raised the floor but did not raise the ceiling: prompt-only
the visual judge plateaus at ~70.

Claude Artifacts-grade output, by contrast, is reliably the result of a
**plan → flesh-out → render** loop, even within a single LLM session.

## Decision

Split generation into a 3-stage pipeline behind feature flag
`AI_MULTI_STEP=1` (off by default until parity is proven on CI):

1. **Outline stage** — `generateOutline(prompt) → { title, durationInFrames,
   palette, scenes: [{ name, durationInFrames, role, keyElements[] }] }`.
   Light JSON-only call, no code. Establishes narrative arc + total
   timing, picks a palette once for the whole piece.
2. **Scene-spec stage** — `generateSceneSpec(outline, sceneIdx) → {
   description, animationType, palette, text, motion: { keyframes[],
   easing, springs[] } }`. One call per scene. Pulls in reference RAG
   addendum scoped to the scene's role (data-viz, transition, text-anim,
   loader, infographic). Stages run in parallel via `Promise.all`.
3. **Code stage** — `generateSceneCode(spec, outline, sceneIdx) → tsx`.
   Pulls reference template into the system prompt. Cached on outline +
   palette so retries don't re-pay outline tokens (ADR-0003 cache key
   stability preserved).

Composition stage (4) stitches per-scene TSX into one `GeneratedAsset`
component using `<Sequence from=... durationInFrames=...>` segments. PARAMS
are merged with per-scene namespacing (`scene1_*`, `scene2_*`). ADR-0002
remains intact — the composition still exports a single `PARAMS` const at
the top level.

## Cost / latency tradeoff

Token consumption is **1.6–2.0× single-call** (outline ~250 tok, N×scene
specs ~400 tok each, N×code calls ~1100 tok each). For a typical 3-scene
piece on Anthropic Sonnet that's ~$0.012 vs ~$0.006 today. Mitigation:

- `cache_control: ephemeral` on system prompts at every stage (ADR-0003).
- Per-scene calls run in parallel where the outline does not declare
  cross-scene state.
- A spend probe at orchestration entry compares projected vs. user's
  remaining quota and returns a soft warning + opt-out hint when the
  request would push spend > 1.7× a normal generate.

The threshold (1.7×) is recorded here as the ratio at which we believe
the user must be informed; the runtime check uses
`MULTI_STEP_COST_RATIO_WARN = 1.7`.

## Live ADR conflicts

- **ADR-0001 (Edit ≠ Render)**: respected — pipeline runs only on the
  generate path.
- **ADR-0002 (PARAMS auto-extract)**: respected — final composition still
  exports a single `PARAMS` const.
- **ADR-0003 (Prompt caching)**: each stage's system prompt carries
  `cache_control` per the existing convention.

## Rollout

Phase 1 (this PR): pipeline behind `AI_MULTI_STEP=1`, unit tests, live
smoke on 5 baseline cases vs. single-shot. No public traffic.
Phase 2: wire the bench gate (TM-46 r7) — if visual-judge mean clears
single-shot mean by ≥5pts on the same prompts, flip default to on.
Phase 3: retire `AI_MULTI_STEP` after one week of green.

## Triggers re-qualify

This ADR triggers re-qualification of TM-46 (visual-judge acceptance gate)
because the pipeline changes the scoring distribution.

## References

- `src/lib/ai/pipeline.ts` (new)
- `src/lib/ai/generate.ts` (call site behind flag)
- `src/lib/ai/prompts.ts` (`OUTLINE_SYSTEM_PROMPT`, `SCENE_SPEC_SYSTEM_PROMPT`,
  `SCENE_CODE_SYSTEM_PROMPT`)
- `wiki/05-reports/2026-04-27-TM-102-fix.md` (this session's report)
