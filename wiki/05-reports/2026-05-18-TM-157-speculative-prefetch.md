---
title: "TM-157 — Speculative asset-gen prefetch during clarify dialog"
date: 2026-05-18
type: session
tags: [perf, latency, asset-gen, clarify]
related: [TM-90, TM-105, TM-153, TM-156]
---

# Summary

TM-156 RCA identified gpt-image-1 wire-time (~34s) as 80% of character-prompt
total latency. TM-157 overlaps that wire-time with the clarify-dialog answer
window (typical 5-15s user-think time) by speculatively firing `runAssetGenStage`
the moment the clarify card appears on the client.

When the user submits answers matching the speculation (first-choice defaults),
the disk-keyed sha256 cache in `asset-gen-stage` (TM-90) short-circuits the
second `/api/generate` call's asset-gen stage to 0ms / $0.

Expected p50 improvement on character prompts: ~25% (41s → ~30s) at >=30%
default-acceptance rate.

# Design

- **New route**: `POST /api/generate/prefetch`
  - Auth-gated, validates prompt, runs `detectLivingEntity` as cost guard
    (skips non-character prompts where asset-gen wouldn't fire anyway).
  - Awaits `runAssetGenStage({prompt, answers: defaultAnswers})` so the PNG
    lands on disk before the response closes — Next.js Node runtime
    cancels detached promises after `return`, so true fire-and-forget on
    the server is unsafe.
  - Returns `{status: ok|skipped|error, cached, hash, costUsd, latencyMs}`.
  - Errors surface as soft 200 with `status:'error'` so the client never
    sees a 5xx for best-effort work.
  - Does NOT consume monthly quota — speculative work amortises across users
    even on cache miss.

- **Client wiring** in `useStudio.ts → generate()`:
  - When `/api/generate` returns `{type: 'clarify'}`, derive default answers
    (`questions[].choices[0].id`) and `void fetch('/api/generate/prefetch', …)`.
  - Uses the SAME `augmentedPrompt` (post URL-attachment merge) the original
    request sent, so the server-side hash matches what the pipeline will
    compute on submit.
  - Fire-and-forget: no await, errors only console.warn — never user-visible.

# Cache hash parity

Both paths call `runAssetGenStage(prompt, answers, style='')`. The hash is
`sha256(prompt + sorted(answers) + style)`. Prefetch and submit share an
identical `(prompt, defaultAnswers)` tuple when the user accepts defaults,
so the in-pipeline disk-cache check (`fileExists(diskPath)`) returns true.

# Cost behaviour

| User picks defaults | Pipeline asset-gen | Total $/req |
|---|---|---|
| Yes (cache hit) | 0ms / $0 | $0.04 (paid by prefetch) |
| No (cache miss) | 34s / $0.04 | $0.08 (prefetch $ wasted, but PNG seeds future hits) |

Acceptance-rate breakeven for net latency win is ~0% (always wins on
matched-defaults users); breakeven for net cost neutrality depends on the
hash-collision rate across users, which is empirical.

# Tests

`__tests__/api/generate/prefetch/route.test.ts` — 13 cases:
- auth gate (401)
- input validation (400 on bad JSON / missing / non-string / over-cap)
- living-entity cost guard (skipped + no stage call for non-character prompts)
- OPENAI_API_KEY gate (503)
- happy path: forwards `(prompt, defaultAnswers)` verbatim, surfaces cache hit
- defensive coercion: drops non-string answer values before hashing
- soft 200 on stage failure; status:skipped on stage-null

Full regression: `__tests__/lib/ai/asset-gen-stage.test.ts` +
`__tests__/api/generate/` — 48/48 green.

# Follow-ups

- Live wall-clock measure on a 1-character prompt (~$0.08, expected ~25% p50
  saving). Deferred to a bench task to avoid burning budget in unit phase.
- Consider extending prefetch to fire on initial prompt submit (before
  clarify roundtrip) once a clarify-likelihood heuristic exists.
- Telemetry: emit `prefetch.fired`, `prefetch.cache_hit_on_submit` so we can
  measure default-acceptance rate in prod.
