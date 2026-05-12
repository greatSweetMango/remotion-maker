---
title: "ADR-0025: branch-locks mutex + pre-PR duplicate guard"
status: accepted
date: 2026-05-13
task: TM-96
supersedes: []
relates: [ADR-0024, "TM-55", "TM-85"]
tags: [orchestrator, concurrency, agent-company]
---

# ADR-0025: branch-locks mutex + pre-PR duplicate guard

## Context

The 3-tier Agent Company (Orchestrator → TeamLead × N → Teammates) is
designed for parallel task execution. In practice TeamLead background
sessions outlive the Orchestrator main session: the main session merges
a PR for `TM-X`, but a TeamLead spawned earlier — still running in
its own context — eventually finishes Phase D and tries to create a PR
for the *same branch* that was already merged.

Observed incidents:

- **TM-55** — main session merged PR #126 for `feat/tm-55`. A
  background TeamLead later created an additional PR on the same
  branch. Two PRs for one task.
- **TM-85** — main session merged PR #132 for `feat/tm-85`. Background
  TeamLead at commit `b39ddb0` opened PR #133 against the same branch
  20 minutes later. User had to close it.
- **TM-87 / TM-93 / TM-95** — same shape, near-miss (caught by manual
  review).

Two distinct races feed this pattern:

1. **branch-locks.json write race.** Two Orchestrator iterations (or
   recovery after a wake-up) read `.agent-state/branch-locks.json`,
   each computes `active_locks`, each writes back. Last-writer-wins
   silently drops the other's entry. Downstream effects: stale
   `active_locks` count → over-allocation of slots → duplicate
   TeamLead spawn for the same branch.
2. **No pre-PR duplicate check.** `gh pr create` is willing to open a
   second PR on a branch whose first PR was just merged (the merged
   PR's head ref was deleted but the branch was recreated locally by
   the background TeamLead's `git push -u`). Nothing in the pipeline
   verifies "is there already a PR for this head?".

## Decision

Adopt two cooperating guards, native-shell only (no new npm deps):

### Guard 1 — `scripts/lib/branch-locks.sh`

A bash helper that serializes every write to
`.agent-state/branch-locks.json` behind a mutex.

- On Linux/CI: use `flock(2)` against
  `.agent-state/branch-locks.lock` (`flock --exclusive --timeout 30
  --conflict-exit-code 75 9 -c "..."`).
- On macOS (no `flock(2)` available by default): fall back to an
  atomic `mkdir` mutex against
  `.agent-state/branch-locks.mutex.d`. `mkdir` is atomic on APFS;
  exactly one process succeeds, others spin with bounded retries.
  Stale-mutex detection reaps holders older than `2 × timeout`.
- Atomic write: `jq … > $TMP && mv $TMP branch-locks.json` after
  JSON validation, so readers never see a partial file.
- Public subcommands: `read`, `set-entry`, `remove-entry`,
  `set-status`, `with-mutex`. Both source-and-call and CLI form.

Orchestrator (`.claude/commands/orchestrate.md` Steps 3, 5, 5-block)
is updated to route every branch-locks mutation through the wrapper.
Direct `jq … | mv` is now forbidden.

### Guard 2 — `scripts/pre-pr.sh`

A pre-PR hook that TeamLead Phase D MUST invoke before
`gh pr create`. It calls `gh pr list --head <branch> --state all`
and exits with a state-specific code:

| exit | meaning           | TeamLead action |
|------|-------------------|------------------|
| 0    | no PR exists      | proceed with `gh pr create` |
| 10   | OPEN PR exists    | DO NOT create. Reuse existing PR (push commits to same branch + `gh pr comment`), return existing URL |
| 11   | MERGED elsewhere  | ABORT. Mark summary `verdict: BLOCK`, `notes: branch already merged via PR #N — TM-55/TM-85 style race avoided` |
| 12   | CLOSED, unmerged  | Allowed but must justify ("supersedes #N") |
| 1/2  | env/usage error   | escalate |

Output is machine-readable (`STATE=...`, `PR_NUMBER=...`, `PR_URL=...`)
so TeamLead's prompt can parse without scraping.

This catches the TM-85 pattern directly: a background TeamLead pushing
new commits + calling `pre-pr.sh` *after* the main session merged will
see `STATE=MERGED`, exit 11, and self-abort instead of opening a
duplicate PR.

## Consequences

**Positive**

- branch-locks writes are now race-free across parallel Orchestrator
  iterations + TeamLead cleanup paths.
- TeamLead can no longer create a duplicate PR even if it was spawned
  long before the parent Orchestrator finished.
- No new dependencies. Pure shell + `jq` (already required by other
  scripts) + `gh` (already required).
- macOS fallback means local dev sees the same behavior CI does,
  which is critical for reproducing race regressions.

**Negative / trade-offs**

- `mkdir`-mutex on macOS isn't kernel-level — a `kill -9` during the
  critical section leaves a stale dir. Mitigated by the
  `2 × timeout` reaper, but in theory a paused process could be
  reaped. Timeout is generous (60s mtime threshold) so this is
  unlikely in practice.
- `pre-pr.sh` adds one `gh` API call per PR creation. Negligible
  cost.
- TeamLead prompt grew Phase D step 7 with the duplicate matrix.
  Slight prompt bloat, but encoded as a 4-row table.

**Follow-ups**

- Optional: a periodic reconciler that walks branches in
  `branch-locks.json` and removes entries whose PRs are already
  merged (defense-in-depth against forgotten entries).
- Optional: extend `pre-pr.sh` to also fail when there are no commits
  ahead of `origin/main` (would block accidental empty PRs).

## Verification

- `scripts/tests/test-branch-locks.sh` — 20 concurrent writers,
  followed by 20 concurrent mixed `set-status`/`remove-entry`. Passes
  5/5 trials (no entries dropped, no invalid JSON).
- `scripts/tests/test-pre-pr.sh` — six mocked `gh` scenarios cover
  exits 0/10/11/12 and "open beats merged" precedence. All pass.

## Related

- `wiki/05-reports/2026-05-13-TM-96-retro.md` — this iteration's retro
- `wiki/05-reports/2026-04-27-TM-85-retro.md` — incident that
  motivated the work
- ADR-0024 — overall agent workflow tooling spine; this is one of its
  TM-93 follow-up tracks (T4a).
