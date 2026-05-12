#!/usr/bin/env bash
# scripts/orchestrator/append-verdict.sh
#
# TM-113 — Append one TeamLead verdict to .agent-state/verdict-history.jsonl.
#
# Called from .claude/commands/orchestrate.md Step 5 once per TeamLead summary
# (immediately after the verdict is parsed, before main-side processing).
# Feeds the `error_rate_spike` signal in scripts/orchestrator/stop-guard.mjs
# (TM-101): consecutive BLOCK / REQUEST_CHANGES verdicts above a threshold
# trigger STOP, halting the orchestrator loop until a human investigates.
#
# Usage:
#   append-verdict.sh <task_id> <verdict>
#
# Args:
#   task_id   — canonical Task Master id (e.g. "TM-113" or bare "113")
#   verdict   — one of APPROVE | REQUEST_CHANGES | BLOCK
#
# Output (JSONL line appended to .agent-state/verdict-history.jsonl):
#   {"ts":"2026-05-13T03:21:18.412Z","task_id":"TM-113","verdict":"APPROVE"}
#
# Flags via env:
#   STATE_DIR=PATH       override .agent-state/ (test isolation)
#
# Exit codes:
#   0  — appended
#   2  — usage / validation error
#   1  — IO / lock error
#
# Concurrency: uses flock(1) on .agent-state/verdict-history.lock when
# available (Linux/CI); falls back to mkdir(1) shell mutex (mac).

set -euo pipefail

usage() {
  echo "usage: $0 <task_id> <verdict>" >&2
  echo "  verdict: APPROVE | REQUEST_CHANGES | BLOCK" >&2
  exit 2
}

if [[ $# -ne 2 ]]; then usage; fi

raw_task_id="$1"
verdict="$2"

# Normalize task_id → "TM-<n>" (accept "TM-113" or "113").
if [[ "${raw_task_id}" =~ ^TM-[0-9]+$ ]]; then
  task_id="${raw_task_id}"
elif [[ "${raw_task_id}" =~ ^[0-9]+$ ]]; then
  task_id="TM-${raw_task_id}"
else
  echo "append-verdict.sh: invalid task_id '${raw_task_id}' (want TM-N or N)" >&2
  exit 2
fi

case "${verdict}" in
  APPROVE|REQUEST_CHANGES|BLOCK) ;;
  *)
    echo "append-verdict.sh: invalid verdict '${verdict}' (want APPROVE|REQUEST_CHANGES|BLOCK)" >&2
    exit 2
    ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
STATE_DIR="${STATE_DIR:-${ROOT}/.agent-state}"
FILE="${STATE_DIR}/verdict-history.jsonl"
LOCK_FILE="${STATE_DIR}/verdict-history.lock"

mkdir -p "${STATE_DIR}"

# Generate ISO-8601 ms timestamp (portable: prefer GNU date, fall back to node).
if ts="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null)" && [[ "${ts}" != *3N* ]]; then
  :
else
  ts="$(node -e 'process.stdout.write(new Date().toISOString())' 2>/dev/null \
        || date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

line="$(printf '{"ts":"%s","task_id":"%s","verdict":"%s"}' \
  "${ts}" "${task_id}" "${verdict}")"

append_line() {
  printf '%s\n' "${line}" >> "${FILE}"
}

if command -v flock >/dev/null 2>&1; then
  # flock-based serialization.
  exec 9>"${LOCK_FILE}"
  if ! flock -w 10 9; then
    echo "append-verdict.sh: could not acquire ${LOCK_FILE}" >&2
    exit 1
  fi
  append_line
else
  # mkdir mutex fallback (macOS without coreutils).
  mutex_dir="${LOCK_FILE}.d"
  tries=0
  until mkdir "${mutex_dir}" 2>/dev/null; do
    tries=$((tries + 1))
    if [[ "${tries}" -ge 50 ]]; then
      echo "append-verdict.sh: could not acquire mutex ${mutex_dir}" >&2
      exit 1
    fi
    sleep 0.1
  done
  # shellcheck disable=SC2064
  trap "rmdir '${mutex_dir}' 2>/dev/null || true" EXIT
  append_line
fi

exit 0
