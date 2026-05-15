---
title: "2026-05-15 — TM-138 vision-guided self-critique loop"
created: 2026-05-15
updated: 2026-05-15
tags: [report, ai, asset-gen, judge, tm-138]
status: active
report_type: session
period: "2026-05-15"
author: TeamLead-TM-138
---

# TM-138 — Vision-guided self-critique on asset-gen PNGs

## TL;DR

- New `judgeAndMaybeRegenerate` loop wired into `generateAssetSingleShot`: every fresh asset-gen PNG is judged via TM-103 `judgeVisual` (gpt-4o); below threshold (default 70) → ONE regen with critique-augmented prompt → keep the higher-scored PNG.
- Live verify on the TM-135 reference prompt (곰돌이 횡스크롤): initial asset-gen scored **83/100** (no retry), forced regen path produced **88/100** (kept regen). Total live spend $0.095 of the $0.30 cap.
- 313 AI tests + 9 new self-critique tests green. Loop is opt-out (`AI_SELF_CRITIQUE=0`), threshold/retries env-tunable, NEVER blocks pipeline (judge/regen failure → fall through).

## 무엇이 바뀌었나

- `src/lib/ai/self-critique.ts` (new) — `judgeAndMaybeRegenerate(opts)`, `buildCritiquePrompt(...)`, `isSelfCritiqueEnabled()`. Reuses `plugin/llm-judge/src/judge.ts judgeVisual` so the determinism contract (temp=0, seed=42) is shared with TM-46/66/111.
- `src/lib/ai/generate.ts` — after `runAssetGenStage` succeeds (and PNG is non-cached), runs the self-critique step before passing to `finalizeWithAssetGen`. The chosen PNG (initial OR regen) drives URL injection into the TSX. Adds `__selfCritique` test seam matching the TM-136 `__assetGenStage` pattern. Added defensive default for TM-136 tests (when `__assetGenStage` is stubbed but `__selfCritique` is not, defaults to a noop pass-through so existing tests don't try to read a fake PNG off disk).
- `__tests__/lib/ai/self-critique.test.ts` (new, 9 tests) — happy path, fail+retry+pick-better, regen-worse-keep-initial, judge-throws, regen-throws, maxRetry=0, env enable/disable, critique prompt embedding.
- `__tests__/benchmarks/tm-138-live-verify.ts` (new) — live driver against real OpenAI. Cost cap $0.30. Output JSON at `__tests__/benchmarks/results/tm-138/live-verify.json`.

## 왜 / 배경

- arxiv 2604.05839 reports +17.8% quality from vision-guided self-critique.
- We already had every piece: TM-90/136 generates the PNG; TM-66/103 judges visuals; TM-100 ai-quality-judge agent uses the same rubric. The only missing wire was: judge the PNG *before* the LLM splices it.
- TM-135 RCA showed the dominant quality regression on living-entity prompts is NOT a bad LLM splice (TM-136 already addresses ignore-the-PNG bug via the back-fill path) but rather can also be a poor PNG when gpt-image-1 misreads the prompt. Self-critique catches both: a low score on the PNG triggers regen with a critique-augmented prompt; an acceptable PNG is kept and TM-136's existing finalizer handles splice errors.

## 설계 선택

- **Judge the PNG, not a Remotion frame.** ADR-0001 forbids server-side rendering on the edit path. The asset-gen PNG IS the visual the LLM is required to splice — judging it directly is the highest-signal, lowest-cost option ($0.005/judge, no @remotion/renderer dependency on the edit path).
- **One regen max.** Each retry burns ~$0.045 (1 image-gen + 1 judge). Stopping at 1 keeps the worst-case cost bounded at ~$0.09/cycle while still catching the dominant failure mode.
- **Skip on cache hit.** A cached PNG was already judged on the prior generation that produced it; re-judging burns dollars for zero new signal.
- **Skip on `cached=true`** + opt-out via `AI_SELF_CRITIQUE=0` + threshold tunable via `AI_SELF_CRITIQUE_THRESHOLD` + retry tunable via `AI_SELF_CRITIQUE_MAX_RETRY`.
- **Never block.** Every failure path returns the original asset unchanged with `retried=false`. The pipeline is unaffected by judge or regen errors.

## 영향

- **System.** Single-shot generate path adds ~4s + $0.005 (judge call) on living-entity prompts that miss the cache. When score < threshold: +~40s + $0.05 (image-gen + 2nd judge). Existing tests (313 AI + 19 TM-136) all pass — defensive default in `generateAssetSingleShot` keeps the TM-136 tests insulated from the new step.
- **Product / users.** Living-entity prompts now self-correct visually weak PNGs before they reach the user — directly addresses the TM-135 "갈색 원" failure family at the asset-gen layer (complementary to the TM-136 splice fix).
- **Cost envelope.** Happy path adds ~$0.005/generation. Worst case (regen fires) adds ~$0.05. Caching ensures zero ongoing cost on stable prompts.

## 라이브 검증 결과

```
[asset-gen]  cached=false cost=$0.040 latency=41.7s hash=1d8c55afdf94 (1.89MB)

[test 1] threshold=70 (happy path)
  scores=[83]  retried=false  extraCost=$0.005  latency=4.0s
  judge: "image is clear and visually appealing with a well-defined bear character..."

[test 2] threshold=99 (forced regen)
  scores=[83, 88]  retried=true  extraCost=$0.050  latency=44.5s
  chosen = regen (88 > 83)

total live spend = $0.095 (cap $0.30)
```

판정 결정성: 동일 입력 두 번 호출 모두 83점으로 일관 (temp=0, seed=42).

## 다음 (follow-ups)

- Threshold calibration sweep — run the TM-46 30-prompt corpus through the loop and chart distribution; current 70 is a starting estimate.
- R2 migration of asset-gen PNGs (already on the ADR-0022 follow-up list) — self-critique reads from disk via `initialDiskPath`; trivial swap to R2 stream.
- Multi-step pipeline (`AI_MULTI_STEP=1`) integration — self-critique today only fires inside the single-shot path; the multi-step path has its own `runAssetGenStage` invocation that should pick this up symmetrically.

## 관련 파일

- `src/lib/ai/self-critique.ts` (new)
- `src/lib/ai/generate.ts` (TM-138 hook in `generateAssetSingleShot`)
- `__tests__/lib/ai/self-critique.test.ts` (new, 9 tests)
- `__tests__/benchmarks/tm-138-live-verify.ts` (new live driver)
- `__tests__/benchmarks/results/tm-138/live-verify.json` (live evidence)
- `wiki/05-reports/2026-05-15-TM-135-quality-rca-research.md` (parent RCA D3)
