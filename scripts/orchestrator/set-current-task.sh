#!/usr/bin/env bash
# TM-117: set the active task_id for spend-ledger.jsonl attribution.
#
# usage:
#   scripts/orchestrator/set-current-task.sh <task_id>
#
# Accepts:
#   - "TM-117" (canonical, written as-is)
#   - "117"    (normalized to "TM-117")
#
# Side effects:
#   - Writes one line "TM-<n>" to .agent-state/current-task (overwriting).
#     The PostToolUse hook reads this file as the second fallback after the
#     CLAUDE_TASK_ID env var (see .claude/hooks/post-tool-use.sh).
#
# Idempotent. Safe to call from any worktree — resolves repo root via git.
set -euo pipefail

if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "usage: $0 <task_id>" >&2
  exit 64
fi

raw="$1"
if [[ "$raw" =~ ^TM-[0-9]+$ ]]; then
  task_id="$raw"
elif [[ "$raw" =~ ^[0-9]+$ ]]; then
  task_id="TM-${raw}"
else
  echo "set-current-task.sh: invalid task_id '$raw' (want TM-N or N)" >&2
  exit 65
fi

# Resolve repo root (handles linked git worktrees).
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

state_dir="$repo_root/.agent-state"
mkdir -p "$state_dir"
printf '%s\n' "$task_id" > "$state_dir/current-task"

# Echo so callers can confirm; harmless if discarded.
printf '%s\n' "$task_id"
