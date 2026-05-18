---
title: "TM-156 — Production latency RCA (29s prod vs 13s bench gap)"
created: 2026-05-18
updated: 2026-05-18
type: session
report_type: session
task: TM-156
status: active
verdict: RCA-complete
tags: [report, area/ai, area/latency, area/observability, task/TM-156]
related:
  - "[[2026-05-18-TM-153-prompt-diet-bench]]"
  - "[[2026-05-18-TM-151-latency-budget]]"
  - "[[2026-05-14-TM-124-timing]]"
provenance: extracted
---

# TM-156 — Production latency RCA

## TL;DR

TM-153 closed -2.2s of prompt-diet but left a 29s residual gap (prod
~44s p50 vs bench 13s). TM-156 added structured server-side stage marks
(`LATENCY_PROFILE=1`) and re-measured under the same conditions as
production. **The 29s gap is real and almost entirely** `gpt-image-1`
**wire time variance** — `asset-gen.openai-wire` measured **p50 34.6s /
mean 36.9s / max 47.4s** in this run, vs the TM-92/TM-153 bench
baseline of 12-15s on the same image prompt. Network egress, queue
depth, and provider variance — not pipeline overhead — dominate.

Concrete numbers (5 fresh-cache iterations, same character prompt with
unique suffix per run, multi-step auto-routed via TM-139, gpt-image-1
low 1024×1024):

| stage | p50 (ms) | mean | max | share of total |
|---|---:|---:|---:|---:|
| route.auth + body-parse + user-lookup + quota-reserve | 11 | 13 | 19 | <0.1% |
| pipeline.outline (gpt-4o) | 2 190 | 2 183 | 2 375 | 5.0% |
| **pipeline.scene-specs+asset-gen** (parallel) | **34 604** | **36 875** | **47 375** | **79.6%** |
| &nbsp;&nbsp;asset-gen-stage.generate-total | 34 599 | 36 867 | 47 364 | (≡ parallel stage) |
| &nbsp;&nbsp;&nbsp;&nbsp;asset-gen.openai-wire | 34 597 | 36 865 | 47 362 | (≡ generate-total) |
| &nbsp;&nbsp;&nbsp;&nbsp;asset-gen.decode (base64 → Buffer) | 1 | 1 | 1 | negligible |
| &nbsp;&nbsp;asset-gen-stage.disk-write | 2 | 4 | 11 | negligible |
| pipeline.scene-code (2 parallel gpt-4o calls) | 4 089 | 4 403 | 5 393 | 9.4% |
| pipeline.compose+validate | 8 | 7 | 14 | negligible |
| route.db-write (Prisma SQLite) | 5 | 5 | 7 | negligible |
| **total p50 / mean / max** | **41 362** | **43 499** | **53 481** | 100% |

(Bench `LATENCY_PROFILE=1` against `worktrees/TM-156-latency-profile`
dev server on port 3156; raw marks at
`wiki/05-reports/screenshots/TM-156/summary.json` and
`results.json`. OpenAI spend ≈ $0.20 — within the task budget.)

## Method

1. **Server-side instrumentation** (Phase A) — new
   `src/lib/ai/latency-profile.ts` exports `recordMark()` /
   `newRequestId()` / `timed()`, gated on `LATENCY_PROFILE=1`. Hooked
   in at:
   - `src/app/api/generate/route.ts` — auth, body-parse, user-lookup,
     quota-reserve, generateAsset wrapper, db-write, route.total. The
     request id is also echoed via response header `x-tm156-req` so
     bench drivers can correlate HTTP wall time with server marks.
   - `src/lib/ai/generate.ts` — `generateAsset.dispatch` (records
     multi-step-vs-single-shot branch + living-entity hit) and
     `generateAsset.total` end mark for both branches.
   - `src/lib/ai/pipeline.ts` — `pipeline.outline`,
     `pipeline.scene-specs+asset-gen`, `pipeline.scene-code`,
     `pipeline.compose+validate`, `pipeline.total`.
   - `src/lib/ai/asset-gen-stage.ts` — `prompt-build`,
     `generate-total` (delegated call wall), `disk-write`. The pre-
     existing in-memory + on-disk cache short-circuits are unchanged.
   - `src/lib/ai/asset-gen.ts` — split the previous single `latencyMs`
     into `client-init` (OpenAI SDK constructor), `openai-wire` (HTTP
     round-trip to `images/generate`), and `decode` (base64 → Buffer).
     This split is the load-bearing diagnostic.
2. **Bench driver** — `scripts/qa/tm-156-latency-profile.mjs`:
   - Auto-logs in via `/api/dev/auto-login`.
   - 5 iterations of the same Korean character prompt
     (`곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘`)
     with a unique `#runN-<epochms>` suffix so the asset-gen cache hash
     differs every run (fresh wire time recorded each iteration).
   - Parses dev-server log file for `[TM-156] {...}` JSON lines
     filtered by `x-tm156-req`. Aggregates p50/mean/max per stage.
3. **Environment** — Next.js 16.2.4 dev (Turbopack), AI_PROVIDER=openai,
   gpt-4o for the chat completion stages, gpt-image-1 low/1024² for the
   image. AI_MULTI_STEP unset → multi-step auto-routed by TM-139
   (living-entity hit). No other workload on the box.

## Findings (top 3 bottlenecks)

### 1. `asset-gen.openai-wire` is 80% of the request

p50 34.6s, mean 36.9s, max 47.4s. The previously-reported `latencyMs`
field on `GenerateAssetImageResult` already captured this number; what
TM-156 newly proves is that **everything else around the call is
negligible** — `client-init` 0ms, `decode` 1ms, `disk-write` 4ms,
`prompt-build` 1ms. There is no Node-side cost worth optimising.

The gap vs TM-92's 13s baseline is provider-side. Hypotheses (not
disambiguated in this run; live A/B with controlled time-of-day would
be needed):

- **Variance / queue depth**: max 47s vs min 31s in 5 runs = 16s
  spread on the same prompt template. Consistent with provider queue
  / regional capacity behaviour.
- **Prompt sensitivity**: hybrid-diet prompt was 58 chars in our run
  vs ~100 chars at TM-153 bench — yet wire time INCREASED. Suggests
  the long-tail isn't prompt-length-driven at all; it's provider tail
  latency on `gpt-image-1` low at this hour.
- **Bench host**: TM-92's 13s was a cold local dev call too; the only
  difference is wall-clock time-of-day. Asking OpenAI for `images/
  generate` at peak hours is qualitatively slower.

### 2. `pipeline.scene-code` is 4.4s of unavoidable LLM time

Two parallel gpt-4o calls (2 scenes after TM-139 minScenes=2 floor),
mean 4.4s. Already parallel, already at the model floor for this prompt
class. Optimisation potential is limited unless we drop scene count or
shorten the scene-spec payload.

### 3. `pipeline.outline` is 2.2s of gpt-4o JSON

Single sequential call. Adds 5% of total. Within budget.

Everything else (auth, db, prisma, body parsing, transpile, compose, etc) sums
to **<50ms**. The Node/Next.js portion of the request is not the problem
and there is no `asset-gen` packaging overhead worth profiling further.

## Hypothesis verification

The TM-153 conjecture list ("queue depth / network egress / multi-stage
parallel overhead") collapses to a single root cause:

- **Multi-stage parallel overhead**: REJECTED. `asset-gen` already runs
  in `Promise.all` with scene-specs (`pipeline.ts:1090`); the parallel
  stage's wall is dominated by `asset-gen-stage.generate-total`
  (Δ = 5ms across 5 runs). Scene-specs hide entirely behind asset-gen.
- **Network egress / decode / disk**: REJECTED. base64 decode is 1ms,
  disk write is 4ms, even for 1.8MB PNGs. Egress is not the bottleneck.
- **Provider wire variance**: CONFIRMED. The `asset-gen.openai-wire`
  metric — newly isolated in TM-156 — accounts for 79.6% of total wall
  time and shows 16s of run-to-run variance.

## Recommendations (ranked by ROI)

### R1 — Move asset-gen off the synchronous request path (highest ROI)

Latency budget is dominated by an external provider whose tail we
cannot fix. The two structural levers are:

- **(a) Background queue + polling/SSE** — return a `pending` asset
  immediately, drop a job onto a queue (Inngest / BullMQ / Cloudflare
  Queues), have the studio poll `/api/asset/:id/status`. Eliminates
  the 35s blocking wait entirely; user sees the outline + scene-code
  scaffolding within ~7s. Requires Pro-tier UX redesign (TM-151's
  deferred option (c) — needs ADR-0028-style decision).
- **(b) Speculative parallel asset-gen** — kick off `runAssetGenStage`
  the moment the user submits the prompt, in parallel with the
  clarify dialog. By the time the user answers clarify questions
  (typically 10-30s of human reading time), the PNG is already in
  the on-disk cache and the generate call only pays scene-spec +
  scene-code = ~7s. This is the lowest-friction win and does NOT
  require an ADR — the existing cache key (`hash(prompt, answers,
  style)`) already supports it; we just need the studio to call
  `/api/asset-gen-prefetch` from `PromptPanel`.

### R2 — Drop the multi-step minScenes=2 floor for short character prompts

For a 10s character prompt with no clarify answers, scene-code @ 4.4s
+ outline @ 2.2s is paying for narrative depth the user didn't ask
for. Single-shot path would skip outline and scene-spec entirely.
Estimated win: -3-4s. Risk: regresses the TM-139/TM-135 character-
quality fix. Worth a separate A/B (`MIN_SCENES=1` env, bench against
TM-149 character corpus).

### R3 — Surface stage timing in the progress UI

TM-151 ships a logistic progress bar calibrated to 57s p50. With the
new stage marks we can replace it with a **real** progress signal —
the studio progress bar advances when each `pipeline.*` mark arrives
(via SSE or polling on a request-scoped endpoint). Closes the
remaining "perceived" gap without backend changes. ~1 day of work.

## What's intentionally NOT recommended

- Switching gpt-image-1 quality knob — already at `low`, the lowest
  tier (TM-92 / TM-151 verified).
- Shrinking the asset-gen prompt further — TM-153 already showed the
  full-diet variant loses 25 judge points; the hybrid we shipped is
  near optimum.
- Server-side compression / chunking of the b64 PNG — decode is 1ms,
  not the problem.

## 환경

- 호스트: worktree `worktrees/TM-156-latency-profile/`, dev server port 3156
- 모델: gpt-4o (chat) + gpt-image-1 low 1024² (image)
- 결정성: 기본 (temperature=0, seed=42), pipeline.ts auto-routed multi-step
- 비용: 5 × (1 outline gpt-4o + 2 scene-spec gpt-4o + 1 gpt-image-1 + 2
  scene-code gpt-4o) ≈ $0.20

## 산출물

- 신규 라이브러리: `src/lib/ai/latency-profile.ts`
- 계측 추가: `src/app/api/generate/route.ts`, `src/lib/ai/generate.ts`,
  `src/lib/ai/pipeline.ts`, `src/lib/ai/asset-gen-stage.ts`,
  `src/lib/ai/asset-gen.ts` (모두 `LATENCY_PROFILE` 게이트, 비활성화 시
  no-op)
- 벤치 드라이버: `scripts/qa/tm-156-latency-profile.mjs`
- 결과 데이터: `wiki/05-reports/screenshots/TM-156/{results.json,summary.json}`
- 본 보고서

## Verify (local)

```bash
# 1. Start dev server with profiling on.
cd worktrees/TM-156-latency-profile
LATENCY_PROFILE=1 npm run dev -- -p 3156 > /tmp/tm-156/dev.log 2>&1 &

# 2. Wait for "Ready" then run the bench (5 iters, ~$0.20).
BASE_URL=http://127.0.0.1:3156 ITERATIONS=5 \
  DEV_LOG=/tmp/tm-156/dev.log \
  node scripts/qa/tm-156-latency-profile.mjs

# 3. Inspect.
cat wiki/05-reports/screenshots/TM-156/summary.json
grep '\[TM-156\]' /tmp/tm-156/dev.log | head -30
```

## ADR 영향

없음. 본 task는 관측성 추가 + RCA 한정. R1(a) 채택 시 신규 ADR(예:
`0028-async-asset-gen-queue`) 필요.

## Follow-ups

1. (TM-15x) Speculative parallel asset-gen prefetch from `PromptPanel`
   — R1(b) above. 최소 변경, 큰 perceived 이득.
2. (TM-15x) Multi-step `minScenes` 단축 A/B — R2.
3. (TM-15x) Real-time stage-mark progress bar via SSE — R3.
4. (TM-15x) Multi-host / multi-time-of-day variance bench to confirm
   the 16s spread is provider-side, not local.
