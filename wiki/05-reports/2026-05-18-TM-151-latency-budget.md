---
title: "TM-151 — Character latency budget review + progressive UX"
date: 2026-05-18
type: session
report_type: session
task: TM-151
status: active
verdict: SHIP
tags: [report, ai, ux, latency, generate, character]
related:
  - "[[2026-05-16-TM-149-stack-validation]]"
  - "[[2026-05-13-TM-92-tier-bench]]"
  - "[[../02-dev/tech-notes/2026-05-18-TM-151-character-latency]]"
provenance: extracted
---

# TM-151 — Character generate latency budget

## TL;DR — SHIP

- TM-149 measured character p50 = **57s** (multi-step + asset-gen).
- Bottleneck breakdown: outline 6s + (scene-specs ∥ asset-gen) 45s + scene-code 6s + compose 2s. asset-gen is the long tail.
- 3 of 5 mitigation options proved either already-shipped or impossible:
  - (d) quality `'low'` default — **already in `asset-gen.ts:62`**.
  - (e) parallel asset-gen + scene-code — **not possible**, scene-code splices the image URL.
- Shipped 1차: **(b) progressive UX** on the main Generate/Edit button — elapsed timer, logistic progress bar (calibrated to 57s p50), 4-stage Korean step copy. No backend change, just closes the perceived-latency gap.
- Deferred: (a) hard cap 90s, (c) Pro-tier async queue. Recorded as follow-ups in the tech-note.

## Acceptance

| 기준 | 결과 | 통과 |
|---|---|:---:|
| 측정값(TM-149) 분석 + breakdown 표 | done | OK |
| 옵션 5종 평가 | done (4 deferred/moot, 1 shipped) | OK |
| 1차 구현 (option b — progressive UX) | shipped | OK |
| 단위 테스트 | 12 PASS (`generation-progress.test.ts`) | OK |
| 기존 PromptPanel 테스트 회귀 없음 | 8/8 PASS | OK |
| typecheck (변경 파일) | clean (pre-existing fixture errors only) | OK |
| lint (변경 파일) | clean | OK |
| tech-note + ADR 검토 | tech-note 작성, ADR 변경 없음 (option c 시 신규 필요) | OK |

## 변경 파일

- `src/lib/generation-progress.ts` (new) — pure step-copy + curve helper
- `__tests__/lib/generation-progress.test.ts` (new) — 12 unit tests
- `src/components/studio/PromptPanel.tsx` — ticker + progress bar + step caption (under existing submit button)
- `wiki/02-dev/tech-notes/2026-05-18-TM-151-character-latency.md` (new) — breakdown + option matrix + deferred follow-ups
- `wiki/05-reports/2026-05-18-TM-151-latency-budget.md` (this file)

## Why option (d) was already shipped

```ts
// src/lib/ai/asset-gen.ts:62
const quality = opts.quality ?? 'low'; // spike → cheapest tier
```

`asset-gen-stage.ts` calls `generateAssetImage({ prompt: imagePrompt })` (no
`quality` field), so the default applies. TM-92's "switch to low" recommendation
landed implicitly at spike time — no further code change needed.

The remaining gap between TM-92's low-tier bench (13s p50) and TM-149's
observed (~44s for the parallel stage) is explained by prompt length:
production prompts append a verbose style suffix + answer KV pairs through
`buildImagePrompt`, while TM-92 used short bench prompts. **Asset-gen prompt
diet** is now the next obvious dial; flagged as follow-up.

## Why option (e) doesn't work

```ts
// src/lib/ai/pipeline.ts:1100-1104
const sceneCodes = await Promise.all(
  sceneSpecs.map((spec, i) => generateSceneCode(outline, spec, i, model, imageUrl)),
);
```

`generateSceneCode` consumes `imageUrl` to splice the PNG into the scene's
`<Img src={…}>`. Without changing the contract (e.g. emit a placeholder + run a
post-render image substitution pass), scene-code must wait for asset-gen.
Worth its own design exploration if Pro-tier queue is built.

## Verify (local)

```bash
npx jest __tests__/lib/generation-progress.test.ts \
         __tests__/components/prompt-panel-retry.test.tsx \
         __tests__/components/prompt-panel-mode.test.ts
# → 3 suites, 20 tests PASS
npx eslint src/lib/generation-progress.ts \
           src/components/studio/PromptPanel.tsx \
           __tests__/lib/generation-progress.test.ts
# → clean
```

Live "before/after" measurement (TM-149 driver re-run) was not performed in
this session — no OPENAI smoke loop in the worktree. The UX win is observable
purely in the static render; the timing assertion is unchanged because the
pipeline itself wasn't touched. Follow-up live run can be folded into the next
TM-149-style stack revalidation.

## Recommended next-up

1. (TM-15x) Pro-tier background-job queue — option C. ADR needed.
2. (TM-15x) Asset-gen prompt-diet A/B — shorten the style suffix, measure
   gpt-image-1 RTT and visual delta vs current.
3. (TM-15x) Hard 90s cap + degraded fallback — only if production telemetry
   shows tail-latency outliers.

## ADR 영향

없음. option (c) 채택 시 신규 ADR(예: 0028-async-render-queue) 필요. 본 task
는 client-side UX 한정.
