---
title: TM-186 — Multi-frame motion-critique + ADR-0016 motion floor + FP harness
created: 2026-06-05
tags: [report, ai, qa, llm-judge, motion, composition-critique]
status: done
task: TM-186
---

# TM-186 — Multi-frame motion-critique

## What

Extended TM-171 single-frame composition-critique (judges one mid frame, blind
to motion) with a qualitative **motion axis**, wired the **ADR-0016
per-category min (motion ≥ 60)** into the generate path so a collapsed motion
category cannot hide behind a passing overall average, and added a
**false-positive (FP) telemetry harness** to gate the eventual default-on flip.

Builds directly on the just-merged TM-184 liveness infra (shared bundle +
`pickRepresentativeFrames` + render-light test pattern). TM-184 owns the
**binary** "does it move at all" (deterministic pixel diff, no LLM). TM-186
owns the **qualitative** "is the motion good" (easing/spring naturalness,
narrative coherence) via the LLM judge.

## Changes

- `src/lib/ai/composition-critique.ts` — `critiqueMotion()`: renders frame0 +
  frameN via the shared TM-171/TM-184 bundle, runs `judgeVisual` N=3 (ADR-0018
  determinism inherited: temperature=0/seed=42/json_object), averages, and
  surfaces per-run variance (`runs`/`deltaMax`/`std`). Maps the 4 visual axes →
  motion categories. A **byte-identical frozen pre-gate** forces
  `motion_present` low BEFORE the judge, so a dead animation can't pass on judge
  nondeterminism. `buildMotionCriteria()` + `MOTION_CATEGORY_MIN = 60`.
- `src/lib/ai/motion-critique-telemetry.ts` — FP record + JSONL ledger
  (`recordMotionFp`, no-op under test runner), `shouldRunMotionCritique()` gate
  (opt-in today via `AI_MOTION_CRITIQUE`/`AI_COMPOSITION_CRITIQUE`;
  `MOTION_CRITIQUE_DEFAULT_ON` flip path structured), `computeMotionFpRate()`
  for the < 5% gate (empty corpus does NOT clear — positive evidence required).
- `src/lib/ai/generate.ts` — motion-critique block after TM-184 liveness.
  ADR-0016 floor → non-blocking warning on `categoryFloorViolated`. Generate
  path only, character/scene + non-cache only, never blocks. `__motionCritique`
  test seam.
- `src/types/index.ts` — `MotionCritiqueMetadata` on `GenerateApiResponse`.
- `scripts/qa/tm-186-motion-fp.mjs` — offline FP measurement harness.

## Standard verification matrix (qa-judge SOP)

| # | Check | Result |
|---|-------|--------|
| 1 | typecheck (touched files) | PASS — 0 errors in composition-critique/motion-critique-telemetry/generate/types. Pre-existing errors in unrelated test fixtures/benchmarks/plugin tests only. |
| 2 | lint (touched files) | PASS — eslint exit 0. |
| 3 | variance probe (N=3 determinism) | PASS — identical-judge run → `deltaMax=0`, `std=0` (within ADR-0018 noise band). Varying-judge run surfaces `deltaMax`/`std` correctly. |
| 4 | static-case FAIL routing | PASS — axis 4 (→40/100) → `categoryFloorViolated=true`, warning routed. Floor `=60` does NOT violate (>= semantics). |
| 5 | unit suites | PASS — 95/95 (motion + telemetry + TM-171 critique + TM-184 liveness). Full `__tests__/lib/ai`: 604 passed, 6 skipped, 0 fail. |

### Per-sample variance summary (ADR-0018 floor: Δmax ≤ 3 / std band)

| Case | runs | deltaMax | std | ADR-0018 band |
|------|------|----------|-----|---------------|
| identical judge ×3 | [80,80,80] | 0 | 0 | within |
| varying judge (synthetic) | [50,70,60] | 20 | >0 | surfaced (telemetry exposes for spawn/PR triage) |

Real LLM variance is inherited unchanged from `judgeVisual` (already
ADR-0018-pinned). Synthetic variance case exists only to prove the variance
**surface** works, not to assert a live band.

## Stability (avoiding the TM-184 render stall)

Followed the TM-184 render-light contract verbatim: all tests inject
`__renderStill` + `judgeClient` stubs — **no real Remotion render and no real
LLM call in jest**. The live judge + render paths are exercised by the offline
FP harness (key + dev server), not unit tests. Did not modify
`composition-critique.ts`'s TM-171 functions (TM-188 conflict avoidance);
`liveness-check.ts` was reuse-only (imported `pickRepresentativeFrames`, no
edits).

## Limitations (live measurement deferred)

- **Live FP rate not measured** — needs a real `OPENAI_API_KEY` + dev server to
  populate the ledger against a labeled corpus. The harness + ledger + gate math
  are in place and unit-tested; the actual `< 5%` measurement + default-on flip
  is a spawned follow-up.
- **Single-image judge** — `judgeVisual` accepts one `image_url`, so the judge
  scores the LATER frame conditioned on the prompt; the binary "did it move" is
  owned by TM-184's pixel diff + the frozen pre-gate. A true two-image
  transition read would need a judge signature change (out of scope, no new dep).

## Acceptance

- [x] Static case motion category < 60 → FAIL routing (deterministic test).
- [x] FP telemetry measurement harness exists (live measurement = follow-up).
- [x] Judge reproducibility within ADR-0018 noise band (N=3, inherited pinning).
