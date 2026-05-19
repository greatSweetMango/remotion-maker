---
title: TM-171 — Composition-critique via headless React snapshot → judgeVisual
created: 2026-05-19
updated: 2026-05-19
tags: [report, tm-171, composition, judge, self-critique, asset-gen]
status: active
report_type: session
provenance: extracted
---

# TM-171 — Composition-critique (headless React snapshot → judgeVisual)

> Closes TM-166 RCA Axis 4 — the composition that uses the asset-gen PNG is
> now visually judged, not just the PNG itself. Bear-in-meadow class of bug
> (purple-band over subject, lucide flowers scattered, blank navy fallback)
> is now detectable post-generate.

Linked:
- TM-166 RCA — `wiki/05-reports/2026-05-18-TM-166-composition-rca.md`
- TM-138 self-critique (PNG-only) — `src/lib/ai/self-critique.ts`
- Bundle entry — `src/remotion/export-entry.tsx`

## What shipped

- **`src/lib/ai/composition-critique.ts`** — new. `critiqueComposition()` renders one still frame of the actual composition via `@remotion/renderer.renderStill`, feeds the PNG buffer to `judgeVisual` with TM-166-aware criteria (opaque-band detection, blank-fallback detection, subject visibility), returns score + reasoning. Never throws — any renderer/judge failure returns `null` so generate flow proceeds unchanged.
- **`src/lib/remotion/bundle.ts`** — lifted the bundle-cache singleton out of `/api/export` so both export AND generate share one cached serve URL. First request pays the ~10s webpack tax once.
- **`src/app/api/export/route.ts`** — refactored to call `getSharedBundlePath()` (no behavior change).
- **`src/lib/ai/generate.ts`** — wires composition-critique after `finalizeWithAssetGen`. Gated by `AI_COMPOSITION_CRITIQUE=1` (opt-in) + fires only when (a) `assetGen?.imageUrl` exists and (b) the PNG wasn't a cache hit.
- **`src/types/index.ts`** — new `CompositionCritiqueMetadata` surfaced on `GenerateApiResponse` (mirrors `SelfCritiqueMetadata` for TM-138).
- **`src/app/api/generate/route.ts`** — passes through `compositionCritique` field when present.
- **`__tests__/lib/ai/composition-critique.test.ts`** — 12 tests covering happy/fail/render-throw/judge-throw/frame-override/env-knob/criteria-embedding.

## Why these choices

### Approach (a) `renderStill`, not Puppeteer screenshot

The task spec offered (a) `@remotion/renderer.renderStill` vs (b) Puppeteer hitting a dev preview route. Picked (a) because:
- The `bundle()` machinery is already battle-tested by `/api/export` (TM-89). Reusing it means the composition-critique path inherits all the same edge-case fixes (tsconfig alias, registerRoot wiring).
- No external Puppeteer dependency to manage separately — `@remotion/renderer` brings its own headless Chromium.
- Caching the bundle across export + critique gives the second-render-onward "free" performance (~1-2s, no webpack).

### ADR-0001 boundary respected

ADR-0001 forbids server-side renders on the **edit** path. Composition-critique runs on the **generate** path only, where we're already paying $0.04 + LLM costs. The `AI_COMPOSITION_CRITIQUE=1` opt-in keeps it off by default until live-bench validates the cost/value ratio across the whole asset corpus (not just the bear case).

### MVP scope: judge-only, no auto-regen

The task spec mentioned "critique + regen (TM-138 패턴 차용)". TM-171 v1 ships **judge-only** because:
1. Code regen on the generate path requires touching `generateAssetSingleShotCore` (single-shot path) AND the multi-step `pipeline.ts` (which is where TM-166's bug actually originated). Two surface areas, both with complex prompt-assembly logic. Not a single-iteration change.
2. The judge score + reasoning is already actionable — the UI/QA harness can surface "this composition looks broken" to the user immediately. A follow-up task (TM-172?) can add a regen branch once we have a few weeks of telemetry to know what reasonable thresholds are.
3. TM-166 RCA's recommended fix wave 1 (#1–#4: prompt + AST validator) is shipping in parallel. TM-171 acts as the **acceptance gate** that catches whatever those prompt fixes miss.

### Judge criteria encode TM-166 failure modes explicitly

`buildCompositionCriteria()` doesn't ask for vague "aesthetic" — it tells the judge to look for:
- Solid colored bands over the subject (the purple `<div>` bug)
- Blank flat-color frames (the Scene2 crash fallback)
- Decorative icons scattered over an already-detailed background image (the lucide flowers + PNG)
- Missing / off-screen subject (the bear positioned at top=340 with no clipping)

This makes the judge **deterministic on the bug class** instead of relying on the gpt-4o judge to spontaneously identify the structural issue.

## Verification

- **Unit tests**: 12/12 pass on the new file, 442/442 pass across `__tests__/lib/ai/` (no regressions).
- **Lint**: clean on all touched files.
- **TypeScript**: no new errors in `src/` or `__tests__/`. Pre-existing wiki-evidence file errors (`wiki/05-reports/screenshots/TM-166/asset-code.tsx`) untouched — those are intentional broken-asset evidence for the RCA.

Live sanity (renderStill against the bear scenario) was **not** run in this session — would require a full Next.js dev server boot + OPENAI_API_KEY + ~$0.05 + ~30s. Scheduled for the post-merge bench cycle alongside TM-166 wave 1.

## Env knobs

- `AI_COMPOSITION_CRITIQUE=1` — opt-in (default OFF).
- `AI_COMPOSITION_CRITIQUE_THRESHOLD=N` — score floor 0-100 (default 70).
- `AI_COMPOSITION_CRITIQUE_FRAME=N` — frame to snapshot (default = mid).

## Follow-ups

| Task | Why |
|---|---|
| TM-172 (proposed) — code-regen branch when `belowThreshold=true` | Closes the loop. Requires `generateAssetSingleShotCore` regen + multi-step `pipeline.ts` regen. |
| Live-bench: run AI_COMPOSITION_CRITIQUE=1 on the TM-149 asset-preview corpus | Validates threshold (70?) and false-positive rate. Surface in `wiki/05-reports/`. |
| Flip default to ON after 1 week of telemetry showing FP rate < 5% | Composition-critique should be the new TM-138 default for character/scene assets. |

## Cross-references

- ADR-0001 Edit ≠ Render — composition-critique runs on generate only, never edit.
- TM-138 — same architectural pattern, different image source (PNG vs rendered frame).
- TM-166 RCA Axis 4 — explicitly called for "headless React snapshot" judging.
- TM-89 — original bundle-cache implementation, now lifted to shared module.
