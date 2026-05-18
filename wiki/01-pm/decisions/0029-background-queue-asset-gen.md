---
title: "ADR-0029: Background queue + polling for asset-gen (R1a from TM-156 RCA)"
created: 2026-05-18
updated: 2026-05-18
tags: [decision, area/ai, area/latency, area/architecture, area/queue]
status: proposed
spawned_from: TM-158
depends_on: [TM-156, TM-157]
related:
  - "[[2026-05-18-TM-156-latency-rca|TM-156 RCA]]"
  - "[[2026-05-18-TM-157-speculative-prefetch|TM-157 R1b]]"
  - "[[2026-05-18-TM-151-latency-budget|TM-151 latency budget]]"
  - "[[0015-routing-streaming-pending|ADR-0015]]"
  - "[[0001-edit-not-equal-render|ADR-0001]]"
provenance: extracted
---

# ADR-0029 — Background queue + polling for asset-gen

## TL;DR

**Decision: ADOPT option (2) — DB-backed `Job` queue (Prisma) + worker
polling, gated behind `?async=1` and a feature flag. Reject (1)
in-process for prod-correctness, reject (3) external services for
cost + new vendor surface.** This ADR is **architectural only** — no
runtime code lands in this task. Implementation, worker process, UI
wiring, and migration are split into ≥4 follow-up tasks (see
**Implementation phasing** below). The current synchronous
`/api/generate` path remains the default until the async path is
QA-validated end-to-end.

Token: **ADR-0029**.

## Context

TM-156's RCA proved that **80% of the p50 latency on `/api/generate`
is the `gpt-image-1` wire call** (mean 36.9s, max 47.4s, p50 34.6s,
run-to-run spread 16s). The remaining ~7s is unavoidable LLM work
(outline + scene-code) that already runs in parallel with asset-gen.

TM-157 shipped R1(b) — speculative prefetch from `PromptPanel` while
the clarify dialog is open — which recovers up to one full
gpt-image-1 wall when the user takes >30s to answer clarify. That win
is bounded: zero-clarify prompts and fast answers (<10s) do not
benefit, and the asset is still consumed synchronously by
`/api/generate`.

TM-156's R1(a) recommendation — **move asset-gen off the synchronous
request path entirely** — is the remaining structural lever. The
user-perceived latency target is ≤7s (outline + scene-code + paint),
matching the TM-151 progress-bar budget that was calibrated to a
deferred future. Hitting that target requires returning the request
before `gpt-image-1` resolves, which in turn requires a job queue.

### Constraints

- **Persistence**: jobs must survive Next.js dev-restart and
  Vercel function cold-starts (Vercel functions are ephemeral and
  multi-instance in prod). An in-process JS `Map<jobId, Promise>`
  is incorrect on multi-instance prod, even though it would work
  locally.
- **No new paid vendor surface**: TM-151 budget review explicitly
  flagged "no new infra spend before TM-180". This rules out paid
  managed queue services for the MVP.
- **Reversibility**: per ADR-0015 precedent, ship the new path
  behind a flag with the sync path still wired. The decision must
  be cheaply revertible if a worker-tier failure mode appears.
- **ADR-0001 boundary preserved**: this affects only the *edit*
  path's asset-gen step. Rendering (Remotion Lambda on Export)
  remains untouched.

## Options

### Option 1 — In-process queue + SSE polling

In-memory `Map<jobId, JobState>` in the Next.js server; SSE channel
per job (reusing the TM-160 SSE infra) streams stage marks until the
asset is ready.

| Pros | Cons |
|---|---|
| Zero new infra | Incorrect on Vercel multi-instance prod (job created on instance A, polled on instance B → 404) |
| Reuses TM-160 SSE plumbing directly | Lost on dev-restart / cold-start |
| Smallest diff (~150 LOC) | Memory pressure on long jobs; no observability across restarts |

**Verdict: REJECT.** Works only in single-process dev. Production
deployment target is Vercel (`vercel.json` present) which is
multi-instance. Shipping this as the prod path would be a regression.

### Option 2 — DB-backed `Job` model (Prisma) + worker polling [CHOSEN]

New `Job` row written transactionally by `/api/generate?async=1`. A
worker process (Vercel cron or self-poll via in-process interval in
dev) picks up `PENDING` jobs and runs the existing
`runAssetGenStage` pipeline. Client polls `/api/jobs/[id]` (or
subscribes via the TM-160 SSE channel once `processingAt` is set).

| Pros | Cons |
|---|---|
| Persistent, multi-instance-correct (SQLite in dev, Postgres/Neon in prod) | One Prisma migration (`Job` table) |
| Zero new external vendor; uses existing DB | Worker process required (Vercel cron 1-min granularity OR client-driven re-trigger pattern) |
| Trivially observable via SQL | Polling overhead (1 req/2s × N jobs) until SSE wired |
| Failure mode is "job stuck in PROCESSING" — clear UX | Retry/lease semantics to design (timeout, max-attempts) |
| Reversible — flag-gated, sync path untouched | Cold-start: first job after idle pays cron interval |

**Verdict: ADOPT.** Single migration; uses tech already in the
stack (Prisma + SQLite/Postgres + Vercel cron); compatible with the
TM-160 SSE channel for the "polling-after-pickup" optimisation.

### Option 3 — External queue (Inngest, Trigger.dev, BullMQ + Upstash)

Drop generation onto a managed queue with native retry, scheduling,
fan-out, and observability dashboards.

| Pros | Cons |
|---|---|
| Production-grade retry / DLQ / observability | New vendor billing surface; quotas to watch |
| Native cron + webhook trigger | New SDK to learn + secrets to manage |
| Multi-tenant fairness primitives | Vendor lock-in or Redis cost (~$10-20/mo) |
| Decoupled scaling | Latency floor: 200-500ms scheduling overhead |

**Verdict: REJECT for MVP.** Capability exceeds what TM-158
solves (single image per request, no fan-out today). Violates the
TM-151 "no new infra spend" constraint. Re-evaluate at TM-180+ once
multi-asset / multi-scene fan-out is on the roadmap.

## Decision

Adopt **Option 2**. Implementation scope is **deferred** — this
task ships the ADR alone. No code change lands in
`worktrees/TM-158-background-queue/` beyond this file.

### Design sketch (binding for follow-up tasks)

#### Prisma model

```prisma
model Job {
  id              String   @id @default(cuid())
  userId          String
  type            String   // "asset-gen" (extensible)
  status          JobStatus @default(PENDING)
  prompt          String
  params          Json     // clarify answers, style, sceneSpec, etc.
  resultAssetId   String?  // FK to Asset on success
  error           String?  // message on FAILED
  attempts        Int      @default(0)
  leasedUntil     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  startedAt       DateTime?
  finishedAt      DateTime?

  user            User     @relation(fields: [userId], references: [id])
  resultAsset     Asset?   @relation(fields: [resultAssetId], references: [id])

  @@index([status, createdAt])
  @@index([userId, createdAt])
}

enum JobStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
  CANCELLED
}
```

#### API surface

- `POST /api/generate?async=1` → creates `Job(status=PENDING)`,
  returns `202 Accepted { jobId, statusUrl: "/api/jobs/<id>" }`.
  Synchronous path (no `?async=1`) is unchanged.
- `GET /api/jobs/[id]` → `{ id, status, progress?, resultAssetId?, error? }`.
  Owner-scoped (userId match required).
- `GET /api/jobs/[id]/stream` → SSE (reuses TM-160 channel) — emits
  stage marks + terminal `done` event with `resultAssetId`. Optional;
  polling is the baseline.
- Worker: separate task ships either (a) a `/api/_cron/process-jobs`
  endpoint hit by Vercel cron every 60s, or (b) a self-trigger
  pattern where `POST ?async=1` fire-and-forget `await fetch(/api/_worker/run, { jobId })`
  on the same request. Decision deferred to TM-NEXT-worker.

#### Lease + retry

- Worker selects `PENDING` jobs with `leasedUntil IS NULL OR leasedUntil < NOW()`,
  sets `status=PROCESSING, leasedUntil=NOW()+5min, attempts++`.
- On crash, lease expires and another worker re-claims. `attempts ≥ 3`
  → `status=FAILED` with `error`.

## Consequences

### Positive

- User-perceived latency drops to outline+scene-code+paint
  (~5-7s p50) vs current 41s p50. Closes the gap TM-151's
  progress-bar UX was designed around.
- Provider tail-latency (max 47s in TM-156) is fully hidden — the
  UI never blocks on it.
- Foundation for future fan-out (multi-asset prompts, batch
  re-generation, scheduled exports).
- Observable: `SELECT status, count(*) FROM Job GROUP BY 1`.

### Negative / new constraints

- **DB migration required** — `prisma db push` in dev,
  `prisma migrate deploy` in prod. Adds one new table + 2 indexes.
- **Worker process to operate** — Vercel cron (free tier: 2
  cron/day on Hobby, unlimited on Pro). MVP can use the
  self-trigger pattern to avoid cron entirely.
- **UI redesign** — studio must show "generating asset…" state
  with progress; existing synchronous-paint code path stays as
  fallback when `?async=1` flag is off.
- **State complexity** — job lifecycle introduces 5 statuses + lease
  semantics + retry counter. QA matrix grows.
- **No supersession** — does not deprecate ADR-0015 or any prior
  ADR. Adds a parallel async lane to the generate path.

### Reversal plan

If the async path is unstable in QA, drop the `?async=1` query
handling from `/api/generate` (one branch in the route handler) and
the studio falls back to sync. The `Job` table can stay (idle) or be
dropped via reverse migration.

## Implementation phasing (follow-up tasks)

1. **TM-NEXT-a — Prisma `Job` model + migration**
   ([wiki/02-dev/tech-notes/nextjs-16-changes.md]: Prisma v6,
   not v7). Tests: CRUD round-trip, status transitions.
2. **TM-NEXT-b — `POST /api/generate?async=1` + `GET /api/jobs/[id]`**.
   Tests: 202 response shape, ownership scoping, async-flag off ==
   current behaviour byte-for-byte.
3. **TM-NEXT-c — Worker**: choose self-trigger vs Vercel cron;
   implement lease + retry. Tests: lease expiry, concurrent worker
   race, max-attempts → FAILED.
4. **TM-NEXT-d — Studio UI**: polling client + "asset generating"
   placeholder + SSE upgrade. Tests: poll cadence, abort on tab
   close, error display.
5. (Optional) **TM-NEXT-e — Production migration + Vercel cron
   wiring**. Smoke-test on preview branch first.

Each follow-up gets its own ADR review only if it diverges from the
sketch above.

## ADR scope clarification

- **In scope**: option matrix, choice, design sketch, phasing.
- **Out of scope (this task)**: any code, any migration, any test.
  Deferred to follow-ups. This matches the orchestrator's
  **scope-cut recommendation** in the TM-158 brief.

## 관련

- 코드 (현 동기 경로, 변경 없음): `src/app/api/generate/route.ts`,
  `src/lib/ai/pipeline.ts`, `src/lib/ai/asset-gen.ts`,
  `src/lib/ai/asset-gen-stage.ts`
- 코드 (재사용 인프라): `src/lib/sse/*` (TM-160),
  `src/lib/ai/latency-profile.ts` (TM-156)
- DB: `prisma/schema.prisma` (변경 예정, 본 task에서는 변경 X)
- RCA: [[2026-05-18-TM-156-latency-rca|TM-156]]
- 선행 ROI: [[2026-05-18-TM-157-speculative-prefetch|TM-157 R1b]]
- 예산: [[2026-05-18-TM-151-latency-budget|TM-151]]
- 관련 ADR: [[0015-routing-streaming-pending|ADR-0015]],
  [[0001-edit-not-equal-render|ADR-0001]]
