---
title: "TM-151 — Character generate latency budget (post-TM-149)"
created: 2026-05-18
updated: 2026-05-18
tags: [dev, ai, latency, ux, generate, character]
status: active
provenance: extracted
---

# TM-151 — Character latency budget review

> 57s p50 (TM-149 measured) is at the upper edge of user tolerance for
> a single button click. This note records the breakdown, options
> considered, and the 1차 shipping change.

## TL;DR

- **Measured (TM-149, n=5 character prompts):** 52.3–60.0s, avg **57.0s**.
- **Bottleneck:** asset-gen long tail (the parallel `scene-specs+asset-gen` stage
  takes ~44.8s — scene-specs themselves finish in ~5-8s, so gpt-image-1 is
  carrying the rest).
- **Already low-tier:** `asset-gen-stage.ts` calls `generateAssetImage(...)`
  without specifying `quality`, which defaults to `'low'` in `asset-gen.ts:62`.
  TM-92's "switch to low" idea is already shipped — there is no quick cost-free
  win on the API side.
- **Shipping now (TM-151 r1):** progressive UX on the main Generate/Edit button
  — elapsed-seconds counter, logistic progress bar calibrated to the 57s p50,
  and 4-stage Korean step copy. Closes the perceived-latency gap without
  touching the pipeline.
- **Deferred:** Pro-tier async job queue (option C), hard 90s cap with degraded
  fallback (option A), parallel asset-gen + scene-code (option E — currently
  impossible: scene-code depends on the asset URL).

## Per-stage breakdown (TM-149 dev log, C01 곰돌이)

```
[pipeline] mode=multi-step stages=outline,scene-specs,asset-gen,scene-code,compose model=gpt-4o
[pipeline]   stage=outline                ms=6215  {"scenes":2,"living_entity":true,"min_scenes":2}
[pipeline]   stage=scene-specs+asset-gen  ms=44766 {"sceneSpecs":2,"assetGenUsed":true,"assetGenCached":false}
[pipeline]   stage=scene-code             ms=~6000 (per fn)
[pipeline]   stage=compose+validate       ms=~2000
[pipeline] done                           totalMs=59432
```

| stage | wall-clock (ms) | dominant? |
|---|---:|:---:|
| outline | ~6,000 | – |
| scene-specs + asset-gen (parallel) | ~45,000 | **YES** — asset-gen long tail |
| scene-code (parallel × N) | ~6,000 | – |
| compose + validate | ~2,000 | – |
| **total** | **~57,000** | |

The pipeline already parallelizes everything it can: asset-gen runs concurrently
with all scene-spec calls (`pipeline.ts:1088-1093`), and scene-code calls run
concurrently after specs land. The only remaining wait is the gpt-image-1 RTT.

TM-92 measured low-tier gpt-image-1 at 13s p50 with a *short* benchmark prompt.
Production prompts (TM-90 `buildImagePrompt` appends a 100-char style suffix
plus answer key-value pairs) push that toward 30-40s — explains the gap from
13s bench → 44s observed.

## Options considered

| # | option | gain | cost | verdict |
|---|---|---|---|---|
| a | hard cap 90s + degraded response | safety net, prevents 503s | adds frustration on edge cases | DEFER — keep as last resort |
| b | progressive UX on main button | 0s actual, big perceived improvement | small client-side change | **SHIP NOW** |
| c | Pro tier background queue + notify | unblocks user for any other work | requires job table + push channel | DEFER — Pro tier roadmap |
| d | image-gen quality `'low'` default | -4s vs medium (TM-92) | acceptable for character per TM-92 | **ALREADY SHIPPED** (asset-gen.ts:62) |
| e | parallel asset-gen + scene-code | -~10s | scene-code needs the imageUrl to splice into `<Img src={…}>` (pipeline.ts:1100-1104) | NOT POSSIBLE without changing the contract |

## Shipped in this task (TM-151 r1)

### New module `src/lib/generation-progress.ts`

Leaf module (no React, no DOM) with two pure helpers:

- `generationProgressMessage(elapsedMs)` — 4-stage Korean copy keyed to elapsed
  seconds (0-5s outline, 5-20s scene/asset, 20-45s asset-gen tail, 45-75s
  compose, 75s+ "over budget" apology).
- `generationProgressPercent(elapsedMs)` — logistic curve `1 - exp(-s/40)`
  calibrated so the bar shows ~50% at 28s, ~76% at 57s (character p50), caps
  at 95.
- Re-used the same pattern as `ParameterControl.progressMessage/Percent`
  (TM-91), which is image-regen-only.

12 unit tests in `__tests__/lib/generation-progress.test.ts`.

### Wire into `PromptPanel`

- `useEffect` ticker (500ms interval) while `isLoading`; resets on transition
  to idle. Same idiom + eslint-disable rationale as the existing
  `setSuggestionSeed` effect.
- Submit button now shows elapsed seconds inline (`{n}s`).
- Below the button: a thin progress bar (mode-coloured violet/emerald) + the
  current step copy under `role="status" aria-live="polite"` for screen
  readers.
- `data-testid="prompt-submit-button"` and `data-testid="generation-progress"`
  hooks added for future E2E.

## Not changed (intentionally)

- `src/lib/ai/asset-gen-stage.ts` — already passes no `quality`, default 'low'
  applies.
- `src/lib/ai/pipeline.ts` — already parallel.
- `src/lib/ai/asset-gen.ts` — default already 'low'.

The original task assumption "set quality='low' as default to save ~4s" turned
out to be moot.

## Next steps (deferred to follow-up tasks)

1. **Pro-tier async queue (option C)** — write to `JobQueue`, return job id,
   poll/SSE for completion. Lets users start a 2nd generate while the first
   churns. Worth its own ADR (impacts billing + UX flow).
2. **Asset-gen prompt diet** — shorter style suffix could shave 5-10s off
   gpt-image-1 RTT. Needs a TM-92-style A/B to confirm quality doesn't drop.
3. **Hard cap (option A)** — implement only if we observe >3% requests crossing
   90s in production telemetry. Should degrade to a "we'll email you" path,
   not an outright failure.
4. **Live before/after measurement** — local dev run was blocked in this task
   window (no `OPENAI_API_KEY` smoke). UX win is observable in the static
   render but the timing assertion needs a follow-up live driver. (TM-149
   already pinned the "before" at 57s avg.)

## Related

- `[[../../05-reports/2026-05-16-TM-149-stack-validation|TM-149 measurement]]`
- `[[../../05-reports/2026-05-13-TM-92-tier-bench|TM-92 quality tier bench]]`
- `[[../../05-reports/2026-04-27-TM-84-spike-result|TM-84 asset-gen spike]]`
- `[[../../01-pm/decisions/0022-character-rendering|ADR-0022]]`
- `src/lib/ai/pipeline.ts:1054-1110` — stage orchestrator
- `src/lib/generation-progress.ts` — TM-151 r1 helper
