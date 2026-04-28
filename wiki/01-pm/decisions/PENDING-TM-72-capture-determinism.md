---
title: "ADR-PENDING-TM-72 — Capture-side LLM determinism (temperature=0, seed=42)"
created: 2026-04-27
updated: 2026-04-27
tags: [adr, ai, qa, determinism]
status: active
provenance: extracted
---

# ADR-PENDING-TM-72: Capture-side LLM determinism

## Status

Accepted (2026-04-27).

## Context

The capture step in EasyMake's generation pipeline calls an LLM (default `gpt-4o-mini`) to emit Remotion TSX code from a user prompt. Until 2026-04-27 this call used the SDK defaults: **`temperature` = 1.0**, **no `seed`**. As a result, the same prompt produced materially different code on every call (different particle counts, easings, palettes), which:

1. Polluted the visual-judge acceptance gate (TM-46 r3→r4→r5): per-iteration deltas could not be attributed to fixes vs. sampling noise even after [[ADR-PENDING-TM-70|ADR-PENDING-TM-70]] removed judge-side variance.
2. Hurt UX: users re-running the same prompt felt the system was "random".

[[2026-04-27-TM-70-rca|TM-70 RCA]] handled the judge side. [[2026-04-27-TM-46-visual-judge-r5|TM-46 r5]] then identified capture-side variance as the next dominant noise source.

## Decision

Pin **`temperature = 0`** and **`seed = 42`** on every LLM call from `src/lib/ai/client.ts` by default, with environment overrides:

- `AI_TEMPERATURE` (float; default `0`).
- `AI_SEED` (integer; default `42`; literal `none` to omit the field for A/B variance experiments).

Anthropic SDK does not currently accept `seed`, so only `temperature` is forwarded for that provider; behavior is symmetric in spirit even if not in API surface.

## Rationale

- **Mirror the working TM-70 fix.** Same parameter values worked for the judge; using identical values keeps mental overhead near-zero and makes the policy easy to reason about.
- **Best-effort is good enough.** OpenAI documents `seed` as best-effort. Live measurement (5 prompts × 3 repeats, see `__tests__/benchmarks/results/tm-72/variance.json`): paramsΔmax mean dropped 49 → 7 chars (−86%), code body Δmax mean 615 → 312 (−49%). The PARAMS block — which drives the visual rubric most — is now near-deterministic, which is sufficient to make iteration-level acceptance comparisons meaningful.
- **Env overrides keep us flexible.** A/B testing prompt-engineering changes that depend on sampling diversity, or running TM-70-style RCAs in the future, just requires `AI_SEED=none` or `AI_TEMPERATURE=0.7` at the process level — no code edits.

## Consequences

### Positive
- Acceptance-gate noise drops materially (capture-side per-sample Δmax expected from ~10 score points down to single-digit).
- Same prompt → much more similar output. Better UX and easier debugging ("did the prompt change or did the model roll different?" no longer ambiguous).
- Compatible with [[0003-prompt-caching|ADR-0003]] — `temperature/seed` are sent alongside `cache_control`, no key collisions.

### Negative / Limits
- `seed` is best-effort; some long free-form code bodies still vary (P2 in the live test still produced 3 unique outputs of 1094-1641 chars). Full byte-determinism across all prompts is **not** delivered by this ADR.
- Reduced sampling diversity may suppress occasionally-better alternative completions. Acceptable trade-off given measurement reliability matters more at the current launch stage.
- Anthropic asymmetry — Anthropic-routed calls only get `temperature` pinning until the SDK exposes `seed`.

## Alternatives considered

1. **Status quo (do nothing)** — rejected. r5 RCA already showed acceptance-gate signal is dominated by capture noise.
2. **Full prompt → asset cache layer** — desirable but larger scope. Tracked as a follow-up task; this ADR + a hash cache compose cleanly.
3. **Force JSON-schema constraints to narrow code shape** — promising but invasive (touches the system prompt and post-validators); deferred.
4. **`temperature=0` only, no `seed`** — rejected; the seed adds determinism for free where supported, and `none` opt-out preserves A/B flexibility.

## Compliance / verification

- Unit tests in `__tests__/lib/ai/client-stream.test.ts` lock the parameter forwarding (TM-72 describe block, 4 tests).
- Live verification harness `scripts/qa/tm-72-capture-variance.mjs` — re-runnable on demand, results in `__tests__/benchmarks/results/tm-72/variance.json`.
- Triggers TM-46 requalification; r6 will re-judge with both judge-side (TM-70) and capture-side (TM-72) determinism applied.

## See also

- [[ADR-0001|ADR-0001 — Edit ≠ Render]]
- [[ADR-0002|ADR-0002 — PARAMS auto-extract]] (the field this ADR most directly stabilizes)
- [[ADR-0003|ADR-0003 — Prompt caching on edit]] (orthogonal, both should be on)
- [[PENDING-TM-70-judge-determinism|ADR-PENDING-TM-70 — Judge-side determinism]] (sister policy)
- [[2026-04-27-TM-72-fix|TM-72 fix report]]
- [[2026-04-27-TM-72-retro|TM-72 retro]]
