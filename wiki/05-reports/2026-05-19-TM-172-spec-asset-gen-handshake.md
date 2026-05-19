---
title: "2026-05-19 — TM-172 spec ↔ asset-gen handshake"
created: 2026-05-19
updated: 2026-05-19
tags: [report, session, multi-step, asset-gen, scene-spec, tm-172, tm-166]
status: active
report_type: session
period: "2026-05-19"
author: TeamLead (Claude Opus)
---

# TM-172 — spec stage now knows what the PNG already contains

## TL;DR

- TM-166 RCA Axis-5 fix: SCENE_SPEC stage was producing `elements: [flowers, ground, sun, …]` even when asset-gen produced a PNG already containing those.
- Pipeline now derives a synchronous `imageDescription` (= `buildImagePrompt(prompt, answers, '')`) and injects it into every `generateSceneSpec` call as `imageAlreadyContains` in the user payload, plus an "IMAGE HANDSHAKE" addendum on the system prompt.
- 6 new unit tests + full AI suite (497 pass) green. Zero added latency — handshake derives from pure-function `buildImagePrompt`, so spec-stage and asset-gen still run in parallel.

## 무엇이 바뀌었나

- `src/lib/ai/pipeline.ts`
  - `generateSceneSpec` gains an optional `imageDescription` parameter.
  - When non-empty: appends a system-prompt addendum prohibiting "flowers / ground / sky / character body / sun / clouds" in `elements`; payload carries `imageAlreadyContains`.
  - Orchestrator computes `imageDescription = buildImagePrompt(prompt, answers, '')` when `livingEntityHit.matched && !disableAssetGen`, else `null`.
- `src/lib/ai/asset-gen-stage.ts` — `buildImagePrompt` re-exported (pure function, already existed for asset-gen).
- `__tests__/lib/ai/pipeline.test.ts` — +6 tests:
  - 3 unit tests on `generateSceneSpec` (no description / with description / empty string).
  - 3 orchestrator tests (Korean character prompt fires handshake; bar-chart prompt does not; `disableAssetGen=true` suppresses handshake).

## 왜 / 배경

[[../05-reports/2026-05-18-TM-166-composition-rca|TM-166 RCA]] Axis 5: spec stage emitted `{kind:'icon', label:'flowers'}` and `{kind:'rect', label:'ground band'}` for "곰돌이 초원 산책". The scene-code stage then dutifully drew those on top of a PNG that already contained flowers and ground, producing the user-reported purple-band + pink-lucide-flower failure.

Improvement #6 from the RCA was a "spec ↔ asset-gen handshake" — tell the spec stage what's already baked into the PNG so it focuses elements/motion on what's genuinely additive (camera parallax, text overlays, sparkles, captions).

## 영향

- **Code**: localized to multi-step pipeline. Single-shot path untouched (it already has the CHARACTER block — see TM-167).
- **Latency**: zero — `buildImagePrompt` is pure, no extra network call. Spec-stage and asset-gen still parallelize via `Promise.all`.
- **Cost**: zero added tokens beyond the addendum (~600 tokens × N scenes for living-entity prompts only).
- **Product**: addresses TM-166 class of failures structurally. Combined with TM-167 (CHARACTER block in SCENE_CODE), TM-178 (bare-imageUrl self-heal), and TM-171 (composition-critique), this closes the multi-step PNG-composition regression class.

## 후속 / 다음

- [ ] Live smoke 1건 — Korean character prompt; confirm spec `elements[]` no longer lists flowers/ground (manual). 📅 2026-05-19
- [ ] If smoke clean → add to TM-149 asset-preview regression corpus.

## 출처 / 링크

- 코드: `../src/lib/ai/pipeline.ts:654` (generateSceneSpec), `../src/lib/ai/pipeline.ts:1185` (orchestrator wiring)
- 테스트: `../__tests__/lib/ai/pipeline.test.ts` (TM-172 imageDescription handshake describe block)
- 선행: [[2026-05-18-TM-166-composition-rca|TM-166 RCA]] Axis 5 / #6
- 형제: TM-167 (CHARACTER block in SCENE_CODE), TM-171 (composition critique), TM-178 (bare-imageUrl self-heal)
