---
title: "ADR-PENDING-TM-93: Agent workflow tooling — specialized agents, MCP servers, skills, orchestrator guards"
created: 2026-05-13
updated: 2026-05-13
tags: [decision, agent-company, infra, meta]
status: proposed
supersedes: []
related:
  - "[[0012-adr-number-collision-avoidance|ADR-0012]]"
  - "[[0014-sandbox-evaluator-hardening|ADR-0014]]"
  - "[[0018-judge-determinism|ADR-0018]]"
  - "[[0020-multi-step-pipeline|ADR-0020]]"
---

# ADR-PENDING-TM-93 — Agent workflow tooling roadmap

## Context

The EasyMake agent company (Orchestrator → PM → TeamLead → build-team) has
shipped 90+ tasks (TM-1 .. TM-86, plus QA r2/r3 cycles). It works, but
post-mortems on the TM-55/TM-64/TM-85/TM-86 cluster surface six **systemic**
inefficiencies that are too large to fix inside any one task:

1. **Generic TeamLead.** Every task spins up a fresh build-team with the same
   PM/Researcher/Architect/Developer/Implementer/Reviewer/QA/Validator
   roles. There is no domain memory — a TeamLead working an AI-prompt task,
   a Remotion-evaluator task, and a CSP-fuzz task get the same skeleton.
   Result: re-discovery cost (each TeamLead re-reads the same files), and
   role mismatches (a "Developer" doing prompt-tuning has no harness for
   diff-based regression).
2. **LLM-as-judge is ad-hoc.** TM-44/TM-46/TM-48/TM-66 each implemented a
   variant of visual / acceptance judging (gpt-4o multimodal, mode_match
   scoring, unintended-change scoring). There is no shared MCP that
   provides `judge.acceptance(asset, criteria) → verdict + rationale`.
3. **Remotion / sandbox validation is scattered.** `src/lib/eval/*.ts` has
   AST + sandbox + CSP checks; `scripts/qa/*` re-implements subsets;
   TeamLead-spawned QA tasks frequently re-run Playwright against a real
   dev server. A unified `mcp__remotion-eval` would let any agent call
   `eval.validate(code) → {syntax, csp, sandbox, params}` without
   re-bootstrapping a dev server.
4. **Trigger / feedback automation is thin.** Night-mode uses
   `ScheduleWakeup` only as a wall-clock idle re-entry; there is no
   cron-style scheduler, no PR-merge → next-task auto-fan-out, no
   STOP-condition codification (e.g. "stop if 3 escalates in a row, stop
   if spend.json exceeds budget"). Idle wake-ups burn tokens without
   forward progress when no task is ready.
5. **TeamLead background race conditions.** TM-55 and TM-85 each produced
   **duplicate PRs** (same branch, two TeamLeads writing — Orchestrator
   visibility was zero until both PRs appeared). branch-locks.json is
   not a true mutex; it is a registry, and concurrent writes silently
   pass.
6. **Spawned task canonical-ID race.** TM-85 retro: when QA spawned an
   AI-BUG task via `task-master add-task`, the returned ID collided with
   the next iter's PM fetch (PM held a stale `next_task` result that no
   longer included the spawn). Result: same logical bug got two TM IDs,
   one orphaned.

We need a roadmap — not one fix — that picks which improvements are
**immediate (skill/agent file add)**, which are **MCP-server scale**
(new TypeScript server in `plugin/`), and which are **orchestrator
protocol changes** (lock semantics, fan-out).

## Decision

Adopt the six-track plan below. Each track lists a verdict
(`immediate | mcp-build | protocol-change`), the artefacts it produces,
and the follow-up task we will spawn against `task-master add-task`.

### Track 1 — Specialized teammate agents (verdict: **immediate**)

Add `.claude/agents/<role>.md` files alongside the existing `pm.md` /
`planner.md` / `marketer.md`. Each file is a system-prompt + tool
allowlist that build-team can route to instead of the generic
Developer/Implementer.

Initial set (priority order):

| Agent file | Domain | Replaces generic role |
|---|---|---|
| `ai-prompt-tuner.md` | LLM prompt edits (`src/lib/ai/prompts.ts`, generate/edit/clarify) with built-in diff + cache-key awareness | Developer + Implementer for `#ai` tasks |
| `remotion-validator.md` | Remotion-specific code validation (PARAMS export, durationInFrames, useVideoConfig) before sandbox | QA |
| `ai-quality-judge.md` | LLM-as-judge harness: takes `(asset, criteria)` → structured verdict; calls gpt-4o multimodal | Validator for `#qa-ai` tasks |
| `csp-fuzzer.md` | Loops the 35-template CSP corpus, escalates on first violation | QA for `#csp` re-qualification |
| `wiki-curator.md` | Owns `wiki/` writes; enforces frontmatter, taxonomy, ADR PENDING token contract | (new) post-PR Phase D split |

Each agent gets a `tools:` allowlist (per Claude Code subagent spec) so
they cannot accidentally drift into general coding (e.g.
`ai-prompt-tuner` is allowed `Edit(src/lib/ai/**), Read, Bash(npm test
--, node scripts/qa/**)` but NOT `Bash(rm, git push)`).

PM's role selection becomes: tag-aware. `#ai` → ai-prompt-tuner.
`#csp` → csp-fuzzer. `#qa-ai` → ai-quality-judge. Fallback: generic.

### Track 2 — New MCP servers (verdict: **mcp-build**)

Three MCP servers to write under `plugin/` (mirror the existing
`plugin/obsidian-mcp/` pattern — TypeScript, SSE transport, registered
in `.mcp.json`):

| MCP id | Purpose | Tools exposed |
|---|---|---|
| `mcp__remotion-eval` | One-call Remotion code validation. Wraps `src/lib/eval/*.ts` so agents don't re-bootstrap | `eval.syntax`, `eval.csp`, `eval.sandbox`, `eval.params`, `eval.all` |
| `mcp__llm-judge` | Structured LLM-as-judge with rubric loading | `judge.acceptance`, `judge.compare(a,b)`, `judge.visual` (multimodal) |
| `mcp__prompt-corpus` | Read/write the canonical prompt-tuning corpus (`__tests__/fixtures/prompts/*.json`) — fetch by tag, append result, query historical pass-rate | `corpus.list`, `corpus.run`, `corpus.diff`, `corpus.history` |

Pre-requisite: each MCP must be **read-only safe for parallel TeamLeads**
(no shared mutable state without a lock). `mcp__prompt-corpus` writes
should be append-only with a content-hash key.

### Track 3 — New Claude Code skills (verdict: **immediate**)

Add `.claude/skills/<name>/SKILL.md` (or `.claude/commands/<name>.md`
if simpler) for repeatable workflows that don't justify a full agent:

| Skill | Trigger | Action |
|---|---|---|
| `prompt-tuning` | "tune prompt", "iterate prompt", `#ai-tune` task | Load corpus → propose 3 prompt variants → run subset → report pass-rate delta + cache-key impact |
| `remotion-validate` | "validate this Remotion code", post-Implementer | Calls `mcp__remotion-eval.eval.all` and formats acceptance gate output |
| `judge-acceptance` | "judge", "is this acceptable?" with asset path | Loads rubric by tag → calls `mcp__llm-judge.judge.acceptance` → emits `APPROVE/REQUEST_CHANGES/BLOCK` |
| `qa-iteration-bump` | After QA verdict=REQUEST_CHANGES | Auto spawns fix task with `triggers_requalify` metadata (codifies the TeamLead SOP §QA task) |
| `night-cycle` | Cron 23:00–06:00 KST | Picks 1 ready task → dispatches → STOP if any of: 3 escalates, spend>limit, no ready task, dawn |

Skill names integrate with the existing `Skill` tool (already loaded
in this session as `build-team:*`, `superpowers:*`, etc.).

### Track 4 — Orchestrator race-detection / spawned-ID reconciliation (verdict: **protocol-change**)

Two concrete changes to `.claude/commands/orchestrate.md`:

**4a. branch-locks.json → real mutex.** Today it's a JSON registry that
two TeamLeads can both write to. Change semantics to:

1. Orchestrator (and only Orchestrator) holds write access.
2. TeamLead requests `acquire(branch, owner_pid)` via a wrapper script
   that uses `flock(2)` on `.agent-state/branch-locks.lock`.
3. Pre-PR-create hook (`.claude/hooks/pre-pr.sh`) reads the lock and
   refuses `gh pr create` if the holding pid is not the caller.
4. Orchestrator's daily reconcile sweep: `gh pr list --head <branch>` —
   if > 1 PR on same head, escalate and close the duplicate.

**4b. Spawned-task canonical-ID reservation.** When TeamLead spawns a
fix task, today it calls `task-master add-task` directly and gets back
an ID, but PM may already have committed a `next_task` plan that
ignores it. Change:

1. TeamLead never calls `task-master add-task` directly. Instead,
   writes a `.agent-state/spawn-queue/<uuid>.json` request file.
2. Orchestrator Step 5-post drains the spawn-queue in a serialized
   single-process loop, calls `task-master add-task`, and commits the
   resulting IDs into `tasks.json` **before** PM's next `next_task`
   fetch.
3. The summary JSON `spawned_tasks[].id_reserved` becomes the canonical
   ID; TeamLead receives it back via a `.spawned/<uuid>.id` file.

This is identical in spirit to ADR-0012 (ADR NNNN reservation) — defer
ID assignment to the single-writer Orchestrator.

### Track 5 — Quality / cost dashboards (verdict: **immediate** for v1, **mcp-build** for v2)

We have the raw signal in `wiki/05-reports/*.md` (mode_match_pct,
params_loss, latency p50, spend in `.agent-state/spend.json`) but no
roll-up. v1: a `scripts/dashboard/roll-up.mjs` that parses retros
and emits a single `wiki/02-dev/dashboards/quality.md` updated
weekly. v2: `mcp__metrics` that exposes the same as queryable tools
(`metrics.trend("mode_match_pct", 30d)`).

Minimum metric set (TM-85/86 already produces these):

- `generate.mode_match_pct` per category (character/motion-graphics/
  data-viz/typography)
- `edit.params_loss` (zero-target)
- `edit.unintended_change_rate` (≤5% target)
- `latency.p50/p95` per pipeline stage
- `agent.escalate_count` per week
- `agent.spend_usd` per task (from `spend.json`)

### Track 6 — Night-mode automation hardening (verdict: **protocol-change**)

Current `ScheduleWakeup` chain is single-shot and re-arms blindly.
Codify:

1. **STOP conditions** in `.claude/commands/orchestrate.md` Phase 7:
   - 3 consecutive iters with no merged PR → STOP
   - `spend.json` today > $5 (configurable) → STOP
   - No ready task (`next_task` returns null) AND no in-progress lock
     → STOP, exit cleanly (no re-arm)
   - Clock past 06:00 KST → STOP
2. **Forward-progress check**: before re-arming, Orchestrator compares
   current HEAD of `main` to HEAD at last wakeup. If no advance and no
   in-progress lock → escalate to user (write to `wiki/00-inbox/`).
3. **Spend ledger**: every TeamLead Phase F summary must include
   `cost_usd_estimate`; Orchestrator appends to `.agent-state/spend.json`
   and writes daily totals to `wiki/02-dev/status.md`.

## Consequences

### Pros

- TeamLead start-up cost drops (specialized agents already know the
  domain; less re-reading).
- Acceptance judging is reproducible (single MCP, single rubric).
- Race conditions on branch + spawned-ID become impossible by
  construction (single-writer Orchestrator).
- Night-mode burns less tokens and never silently regresses.

### Cons / trade-offs

- Up-front cost: ~8-10 follow-up tasks (see below). Roughly two-week
  investment before we see compound returns.
- New MCP servers add dependency surface and require keeping
  `.mcp.json` healthy on every contributor machine.
- Skill explosion risk — must keep `.claude/skills/` curated, not let
  every TeamLead add a one-off skill.

### Rejected alternatives

- **Big-bang rewrite** (replace build-team entirely with a hand-tuned
  `langchain`-style graph). Too risky; would invalidate all existing
  retros and ADRs as a reference set.
- **Just add more agent.md files, no MCPs.** Closes immediate pain
  but doesn't fix the LLM-judge / Remotion-eval duplication. Picks up
  technical debt instead of paying it down.
- **Wait until launch.** Race-condition bugs (Track 4) are already
  causing data loss (duplicate PRs are work that gets discarded).
  Cannot defer.

## Follow-up tasks (to be spawned by Orchestrator post-merge)

Each is sized 2-6 hours (single TeamLead iteration). Listed in
recommended execution order (dependency-respecting).

| # | Title | Track | Priority | Depends on |
|---|---|---|---|---|
| 1 | `agent/ai-prompt-tuner.md` — specialized teammate for #ai tasks | T1 | high | — |
| 2 | `agent/remotion-validator.md` + tag-aware PM routing | T1 | high | 1 |
| 3 | `agent/ai-quality-judge.md` + judge-acceptance skill | T1+T3 | high | — |
| 4 | `mcp__remotion-eval` server scaffold under `plugin/remotion-eval-mcp/` | T2 | medium | 2 |
| 5 | `mcp__llm-judge` server + migrate TM-66 visual-judge to it | T2 | medium | 3 |
| 6 | branch-locks.json → flock mutex + pre-pr.sh hook | T4 | **high** (regression) | — |
| 7 | spawned-task canonical-ID reservation queue | T4 | **high** (regression) | 6 |
| 8 | night-mode STOP conditions + spend-ledger | T6 | medium | — |
| 9 | `scripts/dashboard/roll-up.mjs` + weekly cron | T5 | low | 8 |
| 10 | `mcp__prompt-corpus` server (depends on prompt-tuning corpus existing) | T2 | low | 1 |

Tasks 6 and 7 are flagged **high** because they fix active data-loss
bugs (duplicate PRs, orphaned spawned tasks). Recommend Orchestrator
queue them before any new feature work.

## Validation plan

This ADR is meta-research — no immediate code change. Validation
happens per-follow-up-task:

- T1 agents: A/B compare against generic build-team on the next 5 `#ai`
  tasks; expect ≥20% fewer "re-read the file" Bash calls and equal-or-
  better verdict quality.
- T2 MCPs: parity test vs current scripts (`scripts/qa/tm-42-edit-flow
  .mjs` should return identical numbers via `mcp__llm-judge`).
- T4 protocol: deliberately race two TeamLeads on same branch — second
  must fail at lock acquire, not at PR-create.
- T6 night-mode: 7-night dry-run with verbose `[idle]` logging; expect
  zero re-arms when no ready task and zero overspends.

## References

- TM-55 r2 retro: `wiki/05-reports/2026-05-12-TM-55-tm42-r2.md`
  (duplicate-PR race)
- TM-85 pipeline-quality: `wiki/05-reports/2026-05-13-TM-85-pipeline-quality.md`
  (spawned-task ID race + data-viz over-clarify regression)
- TM-86 retro: `wiki/05-reports/2026-05-13-TM-86-retro.md`
  (judge harness ad-hoc)
- `.claude/commands/orchestrate.md` — current Orchestrator protocol
- `.claude/agents/{pm,planner,marketer}.md` — existing specialized
  agents (precedent for Track 1)
- `prompts/team-lead.md` — current generic TeamLead SOP
- ADR-0012 — ADR-NNNN collision avoidance (precedent for Track 4
  single-writer-Orchestrator pattern)
- ADR-0018 — judge determinism (precedent for Track 2 `mcp__llm-judge`)
- ADR-0020 — multi-step pipeline (Track 5 metric set)
