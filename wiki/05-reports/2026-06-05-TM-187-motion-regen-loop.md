---
type: report
task: TM-187
date: 2026-06-05
area: ai-prompt
adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0016, ADR-0018]
tags: [motion, regen-loop, self-critique, liveness, composition-critique]
---

# TM-187 — Composition motion regen-loop (motion line final enhancement)

## What & why
TM-184 (liveness pixel-diff) and TM-186 (motion-critique judge) only **telemeter +
warn** on bad motion — TM-171's own comment flagged the gap ("regen is a future
task"). TM-187 closes the loop for the MOTION axis by applying the TM-138 PNG
self-critique regen pattern at the **composition** level: when the served code is
`static` (TM-184) OR breaches the ADR-0016 motion floor (TM-186), structure WHAT
was wrong into a regen instruction, re-generate the CODE once, re-run the gate,
keep the better of the two.

## Design
- **`src/lib/ai/composition-regen.ts`** (new) — pure, render-light, fully
  injectable loop. `runMotionRegenLoop({ regenerate, evaluateMotion, ... })` does
  NO model call and NO render itself (both are injected effects), so it is
  deterministically unit-tested with fixtures (static 1st pass → live after regen).
  - `MotionSignal` — small normalized verdict (liveness static + motion-floor +
    aggregateScore for tie-break).
  - `buildMotionRegenAddendum(sig)` — structures the critique: which frames were
    identical + diff vs ε; which motion category collapsed + judge reasoning;
    concrete FIX guidance (bind a useCurrentFrame-driven value to a visible
    property / eased motion of the subject). Preserves the ADR-0002 PARAMS reminder.
  - **Loop guard (acceptance):** `maxAttempts` default 1, **hard cap 2**
    (`MAX_ATTEMPTS_CAP`); cost ceiling (`AI_MOTION_REGEN_MAX_COST_USD`, default
    $0.12) stops BEFORE overspending; on exhaustion returns the best candidate
    with `guardExhausted=true` + a non-blocking warning. NEVER throws, NEVER loops
    past the cap.
- **`src/lib/ai/generate.ts`** — thin hook AFTER the TM-184/TM-186 stages:
  `buildMotionSignalFromMetadata(finalized)` reads the just-computed
  `liveness`/`motionCritique` metadata; if bad and `AI_MOTION_REGEN=1`, runs the
  loop. `regenerate` re-runs `generateAssetSingleShotCore` with the critique
  **appended** to the system prompt (ADR-0003 cache prefix unchanged) and reuses
  the SAME asset-gen PNG (no extra gpt-image-1 spend — only code is regenerated).
  `evaluateMotionForRegen` re-runs the gates render-light via the same
  `__livenessRender` / `__motionCritique` seams. Recovery clears the stale
  TM-184/TM-186 motion warning; exhaustion attaches a best-effort warning.
- **`src/types/index.ts`** — `MotionRegenMetadata` on `GenerateApiResponse`
  (triggered / trigger / attempts / maxAttempts / recovered / guardExhausted /
  cost / latency).
- Default **OFF** (`AI_MOTION_REGEN=1` opt-in) until the night key-loop validates
  live recovery rate — mirrors TM-171/TM-186.

## ADR compliance
- **ADR-0001** generate path only (caller-enforced; edit never renders). Module is
  render-agnostic.
- **ADR-0002** PARAMS untouched — regen re-runs the generation core which enforces
  the export; we never rewrite code.
- **ADR-0003** critique appended → cached system-prompt prefix stable.
- **ADR-0016/0018** the re-run gate is itself deterministic; no new judge logic.

## Verification matrix
| Check | Result |
|---|---|
| `tsc --noEmit` (touched files) | **clean** (composition-regen.ts / generate.ts / types — 0 errors). Repo-wide pre-existing errors in `__tests__/**`, `plugin/**`, `remotion/evaluator*` are untouched by this PR. |
| `eslint` (touched files) | **clean** (0 errors, 0 warnings after removing an unused var). |
| `composition-regen.test.ts` (pure loop) | **15/15 pass** — recovery (static→live in 1 regen, deterministic), loop-guard exhaustion + warning, cost-ceiling stop, hard-cap=2, regenerate/​evaluate throw → never-block, best-of-when-not-recovered. |
| `generate-tm187-motion-regen.test.ts` (wiring) | **3/3 pass** — static liveness + `AI_MOTION_REGEN=1` → loop fires, telemetry applied, recovered clears warning; default-off → loop never fires; live verdict → never fires. |
| Motion-line regression (`liveness-check`, `motion-critique`, `motion-critique-telemetry`, `tm-188-motion-presence`) | **99/99 pass** — no regression. |
| Full `__tests__/lib/ai/**` | **622 pass, 6 skipped, 0 fail**. |
| TM-83 clarify / TM-85 pipeline-quality live benches | **NOT RUN** — require a live dev server + OPENAI key (none in this env). This PR touches NO clarify-gate / classify / prompts.ts routing, so clarify/mode_match is provably unaffected. Re-bench reserved as a spawned night-key-loop task. |
| Live LLM regen + real Remotion render e2e | **NOT RUN** (no key/render). Deferred to the night key-loop (spawned task). |

## Conflict avoidance (TM-89)
Per spec, `pipeline.ts` was **not touched** (TM-89 R2-cache is editing it
concurrently). The regen hook lives entirely in `generate.ts` + the new module;
imports added are additive (rebase-friendly). Two checkpoint commits.

## Follow-ups
- Live recovery-rate validation (key-loop): run with `AI_MOTION_REGEN=1` on a
  static-prone corpus, measure recovered% + cost/latency, decide the default-on
  flip.
- TM-85 r-bench re-run post-merge (routing unaffected, but SOP-required guard).
