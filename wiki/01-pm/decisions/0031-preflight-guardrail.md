---
title: "ADR-0031: Fail-fast preflight guardrail before TeamLead dispatch"
created: 2026-06-05
updated: 2026-06-05
tags: [decision, area/orchestration, area/infra, area/reliability]
status: proposed
spawned_from: TM-207
related:
  - "[[0025-branch-locks-mutex|ADR-0025 branch-locks mutex]]"
provenance: extracted
---

# ADR-0031 — Fail-fast preflight guardrail

## TL;DR

**Decision: ADD a cheap, dependency-free `preflight.sh` that the Orchestrator
runs in Step 3 immediately before dispatching a TeamLead Agent to a worktree.
On failure (exit 20) the task is marked `blocked` with a clear reason and the
dispatch is skipped.** This is purely **additive** — it never weakens the
loop/STOP safety guards; it only converts a class of expensive late failures
into immediate, legible `blocked` verdicts.

## Context — the "mystery 600s death"

A TeamLead dispatched to a worktree that was never properly bootstrapped (no
`.env.local`, `NEXTAUTH_URL` pointing at the wrong port, missing generated
Prisma client) — or to a live-app task with no API key / no running dev server
— does not fail fast. It spins up build-team, burns several minutes of wall
clock and tokens, and then dies deep in the run with an opaque error (or hits a
~600s watchdog). The cost is paid, the cause is obscured, and the Orchestrator
sees only a generic failure rather than an actionable reason.

This is exactly the failure mode that the **OpenAI Swarm *input guardrail***
pattern addresses: validate an agent's inputs *before* paying for the agent
run.

## Decision

Introduce `scripts/orchestrator/preflight.sh <worktree_path> <dev_port> [--require-live]`:

- **Tier (a) — env-only, ALWAYS run (no secrets required):**
  - `<worktree>/.env.local` exists,
  - its `NEXTAUTH_URL` targets `<dev_port>` (cookie-jar / redirect correctness — see TM-65),
  - a generated Prisma client is resolvable from the worktree (TM-46 r6 isolation gap).
- **Tier (b) — live, ONLY under `--require-live`:**
  - required API keys present & non-empty (default `OPENAI_API_KEY`, extendable via `PREFLIGHT_REQUIRED_KEYS`),
  - dev server answers on `localhost:<dev_port>` within a short curl timeout.

Output is a single JSON object `{"ok":bool,"missing":[...],"reason":"..."}`.
Exit `0` = pass, `20` = fail (→ `branch-locks.sh set-status <id> blocked`),
`64` = usage error.

`orchestrate.md` **Step 3 only** is touched: call `preflight.sh` just before the
Task-Master `in-progress` transition; on exit 20, set the task `blocked` (reason
in transcript) and `continue` (skip dispatch). No other step is modified, so the
edit does not collide with concurrent Step-5 work.

## Key-less-environment graceful pass (load-bearing constraint)

The default invocation is **env-only** — it requires **no** API keys. Code and
docs tasks never touch the live app or external APIs, so they must pass in the
key-less CI/dev box. Live checks (keys + dev-server reachability) run **only**
when the caller explicitly passes `--require-live`. This keeps the guardrail
safe to run unconditionally on every dispatch without producing false
`blocked`s in key-less environments.

## Constraints honored

- **Additive, no guard weakening.** A preflight failure only blocks the task;
  the Ralph loop and STOP guards are untouched (no regression).
- **No new npm dependency.** Pure bash + `curl` + `jq` (all already present).
- **Render-light.** No build, no render, no network beyond an optional 3s curl
  probe under `--require-live`.

## Alternatives considered

1. **Do nothing / rely on the watchdog** — rejected: pays full cost, hides the
   cause, pollutes verdict history with opaque failures.
2. **Bake checks into `setup-worktree.sh`** — rejected: setup runs at worktree
   *creation*; preflight must run at *dispatch* time, which can be a later iter
   after state may have drifted. Separation of concerns.
3. **Make preflight always probe keys/dev-server** — rejected: breaks the
   key-less-environment graceful-pass requirement; gated behind `--require-live`
   instead.

## Consequences

- Dispatch-time failures become `blocked: <specific reason>` instead of mystery
  deaths, saving minutes/tokens per bad dispatch.
- The Orchestrator can later add `--require-live` selectively for tasks tagged
  as needing the running app / LLM, without changing the default contract.
- `missing[]` codes (`ENV_LOCAL_MISSING`, `NEXTAUTH_URL_PORT_MISMATCH`,
  `PRISMA_CLIENT_MISSING`, `KEY_MISSING:<NAME>`, `DEV_SERVER_UNREACHABLE`, …) are
  machine-readable for future automation (e.g. auto-rerun `setup-worktree.sh`
  on `PRISMA_CLIENT_MISSING`).

## Tests

`scripts/tests/test-preflight.sh` — 10 cases: bootstrapped env-only pass, port
mismatch, missing `.env.local`, missing prisma client, missing worktree dir,
usage error, key-less env-only graceful pass, `--require-live` missing key,
`--require-live` dev-server probe, unknown-flag rejection. All passing.
