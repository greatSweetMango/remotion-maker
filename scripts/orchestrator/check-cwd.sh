#!/usr/bin/env bash
# scripts/orchestrator/check-cwd.sh
#
# TM-97 — Spawned task canonical-ID reservation guard.
#
# Refuses to be invoked from inside a git worktree subdirectory
# (`worktrees/*`). TeamLead sessions run inside such worktrees, where
# `task-master add-task` would write into a stale `.taskmaster/tasks/tasks.json`
# copy and pick an ID that collides with the canonical task-master DB on `main`
# (see TM-94/TM-85: scheduler spawned "TM-82" which already meant a different
# task → Orchestrator had to hand-reassign as TM-110).
#
# Therefore: from a worktree, TeamLead MUST NOT call task-master add-task.
# Instead it must return the spawned-task description in its summary JSON
# under `spawned_tasks[]`; the Orchestrator (running in the canonical main
# repo) calls `promote-spawned.sh` after the PR merges to add them with
# real canonical IDs.
#
# Usage:
#   bash scripts/orchestrator/check-cwd.sh                # uses $PWD
#   bash scripts/orchestrator/check-cwd.sh <path>         # explicit dir
#
# Exit codes:
#   0 — path is the canonical main repo (safe to mutate task-master DB)
#   20 — path is a git worktree under worktrees/* (DO NOT mutate canonical DB)
#   1 — path does not exist / not inside a git repo
#   2 — usage error

set -euo pipefail

target="${1:-${PWD}}"

if [[ ! -d "${target}" ]]; then
  echo "check-cwd.sh: not a directory: ${target}" >&2
  exit 1
fi

abs="$(cd "${target}" && pwd -P)"

# Detect worktree path. Two heuristics, either is sufficient:
#   1) The path string contains a `/worktrees/` segment (project convention).
#   2) `git rev-parse --git-common-dir` differs from `--git-dir` (canonical
#      git signal that this checkout is a linked worktree, not the primary).
case "${abs}" in
  */worktrees/*)
    echo "WORKTREE=1"
    echo "PATH=${abs}"
    echo "check-cwd.sh: BLOCK — path '${abs}' is inside worktrees/* — do NOT call task-master add-task here (TM-97). Return spawned_tasks in summary JSON instead; Orchestrator will promote via scripts/orchestrator/promote-spawned.sh." >&2
    exit 20
    ;;
esac

# Secondary check via git itself (defends against worktrees outside the
# naming convention, e.g. ad-hoc `git worktree add ../foo`).
if command -v git >/dev/null 2>&1; then
  if gitdir="$(cd "${abs}" && git rev-parse --git-dir 2>/dev/null)" && \
     common="$(cd "${abs}" && git rev-parse --git-common-dir 2>/dev/null)"; then
    # Normalize both to absolute for comparison.
    gd_abs="$(cd "${abs}" && cd "$(dirname "${gitdir}")" 2>/dev/null && pwd -P)/$(basename "${gitdir}")"
    cd_abs="$(cd "${abs}" && cd "$(dirname "${common}")" 2>/dev/null && pwd -P)/$(basename "${common}")"
    if [[ "${gd_abs}" != "${cd_abs}" ]]; then
      echo "WORKTREE=1"
      echo "PATH=${abs}"
      echo "check-cwd.sh: BLOCK — '${abs}' is a linked git worktree (git-dir != git-common-dir) — do NOT call task-master add-task here (TM-97)." >&2
      exit 20
    fi
  fi
fi

echo "WORKTREE=0"
echo "PATH=${abs}"
exit 0
