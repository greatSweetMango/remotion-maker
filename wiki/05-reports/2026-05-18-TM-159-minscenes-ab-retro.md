---
title: "TM-159 retro — minScenes A/B for short character prompts"
date: 2026-05-18
type: experiment
tags: [ai-pipeline, latency, quality-bench, tm-156-followup]
status: ship-gated-on-bench
related: [TM-139, TM-156, TM-46, TM-138]
---

# TM-159 — minScenes A/B for short character prompts

## Context

TM-139 (`__tests__/lib/ai/tm-139-multistep-default.test.ts`) enforces a
`minScenes=2` floor for any living-entity prompt so the multi-step pipeline
can't collapse into single-shot equivalent (RCA TM-124).

TM-156 latency profile measured the cost of the extra scene on character
prompts: `scene-spec ~2.2s` + `scene-code ~4s` per additional scene
(`wiki/05-reports/screenshots/TM-156/summary.json`). For SHORT character
prompts (no duration hint or ≤10s), that extra scene rarely adds narrative
value beyond a single-shot — the user just asked for "a bear walking".

Hypothesis (B variant): for character + short, `minScenes=1` saves ~3-4s
without measurable judge-score drop.

## Design

Two variants, both on the multi-step pipeline:

| Variant | Trigger | minScenes (character + short) | minScenes (character + >10s) | minScenes (non-living) |
|---|---|---|---|---|
| **A** (current default) | flag OFF | 2 (TM-139 floor) | 2 | 1 |
| **B** (opt-in) | `AI_MIN_SCENES_SHORT_CHAR=1` | 1 | 2 | 1 |

"Short" = `extractDurationHint(prompt).seconds === null || ≤ 10`. Long
character prompts always keep the floor — multi-scene pacing is load-bearing
for narrative arcs.

## Implementation (Phase C1 — ship behind flag)

`src/lib/ai/pipeline.ts` `generateAssetMultiStep`:

```ts
const livingEntityHit = detectLivingEntity(prompt, opts.answers);
const shortCharMinScenes1Enabled =
  process.env.AI_MIN_SCENES_SHORT_CHAR === '1' || process.env.AI_MIN_SCENES_SHORT_CHAR === 'true';
let minScenes: number;
if (livingEntityHit.matched) {
  if (shortCharMinScenes1Enabled) {
    const durHint = extractDurationHint(prompt);
    const isShort = durHint.seconds === null || durHint.seconds <= 10;
    minScenes = isShort ? 1 : 2;
  } else {
    minScenes = 2;
  }
} else {
  minScenes = 1;
}
```

Default behavior **unchanged** — TM-139 floor preserved until bench
validates ship criteria. Operators flip via env to A/B in prod.

Tests: `__tests__/lib/ai/tm-159-minscenes-short-char.test.ts` (5/5 ✓)
covering:
- A (flag OFF): short character → minScenes=2 (TM-139 directive injected)
- B (flag ON): short no-hint → minScenes=1, no TM-139 directive
- B (flag ON): short ≤10s hint → minScenes=1
- B (flag ON): long >10s character → minScenes=2 (floor preserved)
- B (flag ON): non-living → minScenes=1 unchanged

TM-139 regression: 6/6 ✓ (no behavior drift when flag OFF).

## Bench (Phase A — design + script ready, live run pending)

Script: `scripts/qa/tm-159-minscenes-ab.mjs`

3 short character prompts × 2 variants × (clarify + generate + image + judge)
≈ $0.30 budget. Uses TM-46-style gpt-4o multimodal visual judge.

Usage:

```bash
# 1. Run A variant against dev server (default env)
BASE_URL=http://127.0.0.1:3159 node scripts/qa/tm-159-minscenes-ab.mjs --variant=A

# 2. Restart dev server with AI_MIN_SCENES_SHORT_CHAR=1, then:
BASE_URL=http://127.0.0.1:3159 node scripts/qa/tm-159-minscenes-ab.mjs --variant=B

# 3. Aggregate + verdict
node scripts/qa/tm-159-minscenes-ab.mjs --aggregate
```

Output → `wiki/05-reports/screenshots/TM-159/{results-A.json,results-B.json,summary.json}`.

## Ship criteria (machine-checked by `--aggregate`)

| Criterion | Threshold |
|---|---|
| Latency | B p50 ≤ A p50 − 2000ms |
| Quality | B judge mean ≥ A judge mean − 5 |

Both met → Phase C2 follow-up flips the default to `AI_MIN_SCENES_SHORT_CHAR=1`
(or removes the flag entirely and makes minScenes=1 the unconditional rule
for character + short). One or both fail → keep current default; the flag
remains an opt-out for cost-sensitive teams.

## Why not ship default ON now?

- Live bench requires a running dev server + ~$0.30 OpenAI spend; not run
  in this autonomous session (no dev server on port 3159 at task start).
- TM-156 latency numbers are suggestive (-3 to -4s expected) but the
  judge-quality side is empirical — we've been burned before
  (`wiki/05-reports/2026-05-15-TM-135-quality-rca-research.md`,
  `wiki/05-reports/2026-04-27-TM-46-visual-judge*`).
- Behind-flag ship lets the next operator run the bench at their
  convenience, observe the verdict, and flip the default with a one-line
  change — no rollback risk in the meantime.

## Files changed

- `src/lib/ai/pipeline.ts` — gated minScenes selection for character+short
- `__tests__/lib/ai/tm-159-minscenes-short-char.test.ts` — new (5 tests)
- `scripts/qa/tm-159-minscenes-ab.mjs` — new bench driver
- `wiki/05-reports/2026-05-18-TM-159-minscenes-ab-retro.md` — this file

## Next

1. Run live bench (`tm-159-minscenes-ab.mjs --variant=A`, then `--variant=B`,
   then `--aggregate`) when an operator has a dev server up and ~$0.30
   budget. Attach `summary.json` recommendation to this report as
   `-bench.md` follow-up.
2. If `shipMet=true`: flip default in `pipeline.ts` (remove the env gate,
   make minScenes=1 unconditional for character+short), promote retro to
   `-r2.md`. New ADR not required — this is a quantitative tuning of the
   TM-139 floor, not a new architecture decision.
3. If `shipMet=false`: document judge reasoning in `-bench.md`, close
   experiment, keep flag as opt-out for latency-sensitive teams.
