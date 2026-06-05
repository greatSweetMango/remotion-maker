#!/usr/bin/env bash
# scripts/orchestrator/write-checkpoint.sh
#
# TM-206 — Write/overwrite the TeamLead Phase checkpoint at
# .agent-state/checkpoint.json (worktree-local, gitignored runtime file).
#
# Companion to scripts/orchestrator/append-progress.sh (TM-205). Where
# append-progress emits an *append-only* in-flight health signal that the
# Orchestrator reads (stop-guard.mjs `phase_loop`), this writes a single,
# always-latest *durable resume marker* that the TeamLead itself reads on its
# first turn after a watchdog/overload kill + re-dispatch. The two coexist:
# both fire at the same Phase boundary (A..F) of prompts/team-lead.md, and
# write-checkpoint runs immediately AFTER the matching append-progress line.
#
# Semantics (LangGraph-style checkpoint): last_completed_phase is a
# high-water-mark — it is written only once a Phase has fully finished, so a
# kill mid-Phase leaves that Phase NOT reflected and the resume preamble
# re-runs it from scratch (safe default: partial work discarded; PR/commit
# side-effects are absorbed by the Phase D pre-PR dup guard + git idempotency).
#
# Usage:
#   write-checkpoint.sh <task_id> <last_completed_phase> "<next_step>" ['<artifacts_json>']
#
# Args:
#   task_id               — canonical Task Master id ("TM-206" or bare "206")
#   last_completed_phase  — Phase label (A|B|C|D|E|F, or short token)
#   next_step             — short free-text one-liner (quoted)
#   artifacts_json        — OPTIONAL compact JSON object of accumulated
#                           artifacts (pr_url, branch, commit_hash, adr_path,
#                           context_file, ...). Merged with any existing
#                           checkpoint.json artifacts (new keys win). Defaults
#                           to "{}" when omitted.
#
# Output (.agent-state/checkpoint.json, OVERWRITTEN each call):
#   {"task_id":"TM-206","last_completed_phase":"D",
#    "artifacts":{"pr_url":"...","commit_hash":"..."},
#    "next_step":"Phase E cleanup","ts":"2026-06-05T14:33:00.000Z"}
#
# Flags via env:
#   STATE_DIR=PATH   override .agent-state/ (test isolation)
#
# Exit codes:
#   0  — written
#   2  — usage / validation error
#   1  — IO error
#
# This file is gitignored (.agent-state/checkpoint.json) — never staged.
# Single writer per worktree (one TeamLead owns its worktree), so no cross-
# process lock is needed; the write is still atomic (temp + mv) so a reader
# never sees a half-written file.

set -euo pipefail

usage() {
  echo "usage: $0 <task_id> <last_completed_phase> \"<next_step>\" ['<artifacts_json>']" >&2
  exit 2
}

if [[ $# -lt 3 || $# -gt 4 ]]; then usage; fi

raw_task_id="$1"
phase="$2"
next_step="$3"
artifacts_json="${4:-{\}}"

# Normalize task_id → "TM-<n>" (accept "TM-206" or "206").
if [[ "${raw_task_id}" =~ ^TM-[0-9]+$ ]]; then
  task_id="${raw_task_id}"
elif [[ "${raw_task_id}" =~ ^[0-9]+$ ]]; then
  task_id="TM-${raw_task_id}"
else
  echo "write-checkpoint.sh: invalid task_id '${raw_task_id}' (want TM-N or N)" >&2
  exit 2
fi

if [[ -z "${phase}" ]]; then
  echo "write-checkpoint.sh: last_completed_phase must be non-empty" >&2
  exit 2
fi

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
next_step_esc="$(json_escape "${next_step}")"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
STATE_DIR="${STATE_DIR:-${ROOT}/.agent-state}"
FILE="${STATE_DIR}/checkpoint.json"

mkdir -p "${STATE_DIR}"

# ISO-8601 ms timestamp (portable: GNU date, else node, else seconds).
if ts="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null)" && [[ "${ts}" != *3N* ]]; then
  :
else
  ts="$(node -e 'process.stdout.write(new Date().toISOString())' 2>/dev/null \
        || date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

# Merge artifacts with any prior checkpoint's artifacts (new keys win), then
# assemble the final object. Prefer node for robust JSON; fall back to a flat
# write that uses the provided artifacts_json verbatim when node is absent.
build_with_node() {
  ARTIFACTS_JSON="${artifacts_json}" \
  PRIOR_FILE="${FILE}" \
  CK_TASK_ID="${task_id}" \
  CK_PHASE="${phase}" \
  CK_NEXT="${next_step}" \
  CK_TS="${ts}" \
  node -e '
    const fs = require("fs");
    let incoming = {};
    try { incoming = JSON.parse(process.env.ARTIFACTS_JSON || "{}"); }
    catch (e) {
      console.error("write-checkpoint.sh: artifacts_json is not valid JSON: " + e.message);
      process.exit(2);
    }
    if (incoming === null || typeof incoming !== "object" || Array.isArray(incoming)) {
      console.error("write-checkpoint.sh: artifacts_json must be a JSON object");
      process.exit(2);
    }
    let prior = {};
    try {
      const raw = fs.readFileSync(process.env.PRIOR_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.artifacts && typeof parsed.artifacts === "object") prior = parsed.artifacts;
    } catch (e) { /* no prior checkpoint — cold artifacts */ }
    const merged = Object.assign({}, prior, incoming);
    const out = {
      task_id: process.env.CK_TASK_ID,
      last_completed_phase: process.env.CK_PHASE,
      artifacts: merged,
      next_step: process.env.CK_NEXT,
      ts: process.env.CK_TS,
    };
    process.stdout.write(JSON.stringify(out));
  '
}

tmp="${FILE}.tmp.$$"
if command -v node >/dev/null 2>&1; then
  payload="$(build_with_node)"; rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    echo "write-checkpoint.sh: failed to build checkpoint JSON (rc=${rc})" >&2
    exit "${rc}"
  fi
  printf '%s\n' "${payload}" > "${tmp}"
else
  # node-less fallback: no prior-merge, artifacts used verbatim (must be valid
  # compact JSON object). This path is best-effort for mac-without-node CI.
  printf '{"task_id":"%s","last_completed_phase":"%s","artifacts":%s,"next_step":"%s","ts":"%s"}\n' \
    "${task_id}" "${phase_esc}" "${artifacts_json}" "${next_step_esc}" "${ts}" > "${tmp}"
fi

mv -f "${tmp}" "${FILE}"
exit 0
