---
title: "TM-90 — multi-step pipeline asset-gen integration"
date: 2026-05-13
type: feature
tags: [tm-90, multi-step, asset-gen, adr-0022, gpt-image-1]
related:
  - "[[TM-84]]"
  - "[[ADR-0022]]"
  - "[[ADR-0020]]"
---

# TM-90 — multi-step pipeline asset-gen integration

## Outcome

Wired the TM-84 spike's `generateAssetImage()` into the multi-step generate
pipeline (ADR-0020) as a parallel stage. Living-entity prompts (character /
animal / person — KO + EN dictionary) now produce a real PNG via OpenAI
gpt-image-1 and reference it via `PARAMS.imageUrl` in the composed code.
Data-viz / abstract prompts skip the stage entirely (zero cost regression).

## Architecture

- `src/lib/ai/asset-gen-stage.ts` — new wrapper.
  - `detectLivingEntity(prompt, answers?)` — KO/EN dict matcher; checks
    prompt + clarify answers (so "subject: 곰돌이" answered post-clarify
    still triggers).
  - `hashAssetGenInputs(prompt, answers, style)` — sha256 over canonical
    `prompt\nsorted-answers\nstyle`, used as filename for idempotency.
  - `runAssetGenStage(input)` — returns `null` on no-hit; else
    `{ imageUrl, costUsd, latencyMs, cached, hash, matchedToken }`. Two
    short-circuits: in-memory `Set<hash>` (same-process repeat) and
    `fs.access` on `public/uploads/asset-gen/<hash>.png` (process restart).
- `src/lib/ai/pipeline.ts` — wires the stage into `generateAssetMultiStep`.
  - Runs in **parallel** with the scene-spec stage (`Promise.all`) so the
    PNG generation overlaps the LLM round-trips. Wall-clock cost ≈
    `max(spec, image)` not the sum.
  - Threads `imageUrl` into `generateSceneCode` (LLM gets a system-prompt
    addendum: "splice `<Img src={imageUrl} />` for the character"), and
    into `composeSceneCodes` (top-level `PARAMS.imageUrl` with
    `// type: text` for ADR-0002 customize-UI auto-bind).
  - Failure isolation: any asset-gen error caught → null, pipeline
    continues with no image (logs warning in dev only).

## Verification

| Check | Result |
|---|---|
| Unit tests (`asset-gen-stage.test.ts`) | 22/22 pass — detection, hash determinism, idempotency, cache hit on disk + memory, skip path |
| Existing tests (`__tests__/lib/ai/`) | 12 suites, 273 pass, 6 skipped — no regressions |
| typecheck (changed files) | clean |
| eslint (changed files) | clean |
| Live spike (`scripts/qa/tm-90-e2e-spike.mjs`) | $0.04 spent — 1 image generated (1.55 MB cute cartoon bear, 36s latency on `low` quality), 2nd call cache-hit at $0, data-viz prompt skipped |

Generated PNG (mascot test): `public/uploads/asset-gen/4cf06653…ab5037.png`
— matches "곰돌이 캐릭터가 초원을 걸어가는" prompt with high fidelity.

## Cost / latency profile

| Path | API calls | Cost | Notes |
|---|---|---|---|
| Living-entity prompt, first-ever | 1× gpt-image-1 + LLM stages | +$0.04 | 36s latency at `quality: 'low'` |
| Same prompt, repeat | 0 image calls | +$0 | hash → disk → cache hit |
| Data-viz / abstract | 0 image calls | $0 | living-entity gate fails |

## Storage policy

Local FS only (`public/uploads/asset-gen/`), per TeamLead spec. Pattern
matches TM-109 thumbnail upload. R2 migration is the spawned follow-up
(TM-89 in spec).

`.gitignore`: `/public/uploads/` added so PNGs never enter the repo.

## Spawned follow-ups

- **TM-89** (R2 cache for asset-gen) — single-server FS won't survive a
  serverless redeploy. R2 with same `<sha256>.png` key gives multi-instance
  share + cold-start safety.
- **Quality knob** — currently hardcoded to `quality: 'low'` ($0.04). Should
  be exposed as PARAMS / env knob once R2 lands so users can opt into
  `medium` ($0.08) for hero assets.
- **Bench (TM-46)** — should re-run visual-judge against the 5-case
  living-entity slice with multi-step + asset-gen ON to confirm uplift over
  single-shot baseline (ADR-0022's hypothesis).
- **Style options** — currently a single hardcoded style string. ADR-0022
  mentions a 4-style picker; deferred to keep this task scoped.

## ADR alignment

- ADR-0020 (multi-step): adds 4th stage, gated by same `AI_MULTI_STEP=1`.
- ADR-0022 (asset-gen): 1차 핵심 통합 — option B (gpt-image-1 live) with
  local-FS caching. R2 + style picker = phase 2.
- ADR-0002 (PARAMS auto-extract): `imageUrl: ... // type: text` keeps the
  customize UI auto-bind contract.
