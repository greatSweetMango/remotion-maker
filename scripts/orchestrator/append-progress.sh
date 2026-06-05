#!/usr/bin/env bash
# scripts/orchestrator/append-progress.sh
#
# TM-205 — Append one Magentic-One-style progress-ledger row to
# .agent-state/progress-ledger.jsonl.
#
# Mirrors scripts/orchestrator/append-verdict.sh (TM-113). Where append-verdict
# captures a post-hoc verdict per finished TeamLead, this captures *in-flight*
# health: each TeamLead emits one line at the end of every Phase (A..F) of
# prompts/team-lead.md. The result is an append-only JSONL stream that
# scripts/orchestrator/stop-guard.mjs reads to detect a stalled task (the
# `phase_loop` signal — 2+ consecutive progress_made=0 for the same task).
#
# The four booleans echo the Magentic-One orchestrator ledger:
#   progress_made — did this phase advance the task? (0|1)
#   in_loop       — is the task repeating the same failing action? (0|1)
#   satisfied     — is the task's acceptance fully met? (0|1)
#   next_action   — free-text one-liner describing the intended next move.
#
# Usage:
#   append-progress.sh <task_id> <phase> <progress_made:0|1> <in_loop:0|1> \
#                      <satisfied:0|1> "<next_action>"
#
# Args:
#   task_id        — canonical Task Master id (e.g. "TM-205" or bare "205")
#   phase          — Phase label (A|B|C|D|E|F, or a free short token)
#   progress_made  — 0 or 1
#   in_loop        — 0 or 1
#   satisfied      — 0 or 1
#   next_action    — short free-text (quoted)
#
# Output (JSONL line appended to .agent-state/progress-ledger.jsonl):
#   {"ts":"2026-06-05T03:21:18.412Z","task_id":"TM-205","phase":"A",
#    "progress_made":1,"in_loop":0,"satisfied":0,"next_action":"build-team spawn"}
#
# Flags via env:
#   STATE_DIR=PATH       override .agent-state/ (test isolation)
#
# Exit codes:
#   0  — appended
#   2  — usage / validation error
#   1  — IO / lock error
#
# Concurrency: uses flock(1) on .agent-state/progress-ledger.lock when
# available (Linux/CI); falls back to mkdir(1) shell mutex (mac). Identical
# strategy to append-verdict.sh / scripts/lib/task-queue.sh so parallel
# TeamLeads serialize their appends with zero lost writes.

set -euo pipefail

usage() {
  echo "usage: $0 <task_id> <phase> <progress_made:0|1> <in_loop:0|1> <satisfied:0|1> \"<next_action>\"" >&2
  exit 2
}

if [[ $# -ne 6 ]]; then usage; fi

raw_task_id="$1"
phase="$2"
progress_made="$3"
in_loop="$4"
satisfied="$5"
next_action="$6"

# Normalize task_id → "TM-<n>" (accept "TM-205" or "205").
if [[ "${raw_task_id}" =~ ^TM-[0-9]+$ ]]; then
  task_id="${raw_task_id}"
elif [[ "${raw_task_id}" =~ ^[0-9]+$ ]]; then
  task_id="TM-${raw_task_id}"
else
  echo "append-progress.sh: invalid task_id '${raw_task_id}' (want TM-N or N)" >&2
  exit 2
fi

if [[ -z "${phase}" ]]; then
  echo "append-progress.sh: phase must be non-empty" >&2
  exit 2
fi

for pair in "progress_made:${progress_made}" "in_loop:${in_loop}" "satisfied:${satisfied}"; do
  name="${pair%%:*}"
  val="${pair#*:}"
  if [[ "${val}" != "0" && "${val}" != "1" ]]; then
    echo "append-progress.sh: ${name} must be 0 or 1 (got '${val}')" >&2
    exit 2
  fi
done

# JSON-escape free-text fields (backslash, double-quote, control chars).
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\t'/ }"
  s="${s//$'\r'/ }"
  printf '%s' "${s}"
}
phase_esc="$(json_escape "${phase}")"
next_action_esc="$(json_escape "${next_action}")"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
STATE_DIR="${STATE_DIR:-${ROOT}/.agent-state}"
FILE="${STATE_DIR}/progress-ledger.jsonl"
LOCK_FILE="${STATE_DIR}/progress-ledger.lock"

mkdir -p "${STATE_DIR}"

# Generate ISO-8601 ms timestamp (portable: prefer GNU date, fall back to node).
if ts="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null)" && [[ "${ts}" != *3N* ]]; then
  :
else
  ts="$(node -e 'process.stdout.write(new Date().toISOString())' 2>/dev/null \
        || date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

line="$(printf '{"ts":"%s","task_id":"%s","phase":"%s","progress_made":%s,"in_loop":%s,"satisfied":%s,"next_action":"%s"}' \
  "${ts}" "${task_id}" "${phase_esc}" "${progress_made}" "${in_loop}" "${satisfied}" "${next_action_esc}")"

append_line() {
  printf '%s\n' "${line}" >> "${FILE}"
}

if command -v flock >/dev/null 2>&1; then
  # flock-based serialization.
  exec 9>"${LOCK_FILE}"
  if ! flock -w 10 9; then
    echo "append-progress.sh: could not acquire ${LOCK_FILE}" >&2
    exit 1
  fi
  append_line
else
  # mkdir mutex fallback (macOS without coreutils).
  mutex_dir="${LOCK_FILE}.d"
  tries=0
  until mkdir "${mutex_dir}" 2>/dev/null; do
    tries=$((tries + 1))
    if [[ "${tries}" -ge 100 ]]; then
      echo "append-progress.sh: could not acquire mutex ${mutex_dir}" >&2
      exit 1
    fi
    sleep 0.1
  done
  # shellcheck disable=SC2064
  trap "rmdir '${mutex_dir}' 2>/dev/null || true" EXIT
  append_line
fi

exit 0
