#!/usr/bin/env bash
# Unit tests for scripts/orchestrator/ci-gate.sh (TM-208).
#
# Mocks `gh pr checks` output via CI_GATE_CHECKS_CMD so no real gh/network is
# needed. Each case asserts the script's exit code (0 mergeable / 20 blocked)
# and, where relevant, the decision field in the JSON verdict.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="${HERE}/orchestrator/ci-gate.sh"

if [[ ! -f "${GATE}" ]]; then
  echo "[test] FAIL: missing ${GATE}"
  exit 1
fi

sandbox="$(mktemp -d -t ci-gate-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT

# Isolate red-history + allowlist so tests don't touch repo state.
export CI_GATE_RED_HISTORY="${sandbox}/red-history.jsonl"
export CI_GATE_ALLOWLIST_FILE="${sandbox}/allowlist.txt"
: > "${CI_GATE_ALLOWLIST_FILE}"
# fast polling so pending cases finish quickly
export CI_GATE_MAX_WAIT=2
export CI_GATE_POLL_INTERVAL=1

fail=0

# run_case <desc> <want_exit> <want_decision|""> <checks_json>
run_case() {
  local desc="$1" want_exit="$2" want_decision="$3" checks="$4"
  local out got decision
  out="$(CI_GATE_CHECKS_CMD="printf '%s' '${checks}'" bash "${GATE}" 99 2>/dev/null)"
  got=$?
  if [[ "${got}" -ne "${want_exit}" ]]; then
    echo "[test] FAIL ${desc}: expected exit ${want_exit}, got ${got} (out: ${out})"
    fail=1; return
  fi
  if [[ -n "${want_decision}" ]]; then
    decision="$(printf '%s' "${out}" | jq -r '.decision')"
    if [[ "${decision}" != "${want_decision}" ]]; then
      echo "[test] FAIL ${desc}: expected decision=${want_decision}, got ${decision} (out: ${out})"
      fail=1; return
    fi
  fi
  echo "[test] OK ${desc} → exit ${want_exit}${want_decision:+ decision=${want_decision}}"
}

ALL_GREEN='[{"name":"build","bucket":"pass"},{"name":"E2E","bucket":"pass"}]'
GREEN_AND_SKIP='[{"name":"build","bucket":"pass"},{"name":"optional","bucket":"skipping"}]'
CIRC_ONLY='[{"name":"build","bucket":"pass"},{"name":"Lint — circular dependencies","bucket":"fail"}]'
REAL_RED='[{"name":"build","bucket":"pass"},{"name":"E2E","bucket":"fail"}]'
RED_PLUS_CIRC='[{"name":"E2E","bucket":"fail"},{"name":"Lint — circular dependencies","bucket":"fail"}]'
EMPTY='[]'

# --- Acceptance criteria ----------------------------------------------------
# all green → exit 0
run_case "all checks green" 0 "green" "${ALL_GREEN}"
# green + skipped → exit 0 (skip folds into pass)
run_case "green + skipped" 0 "green" "${GREEN_AND_SKIP}"
# only circular-dep red (allowlisted) → exit 0 (must NOT block — self-merge safe)
run_case "only allowlisted circular-dep red" 0 "known-red-only" "${CIRC_ONLY}"
# a real red check → exit 20 (blocked)
run_case "real red check blocks" 20 "red" "${REAL_RED}"
# real red + allowlisted red → still blocked by the real one
run_case "real red alongside allowlisted red blocks" 20 "red" "${RED_PLUS_CIRC}"
# no checks at all → exit 0 (nothing red)
run_case "no checks reported" 0 "green" "${EMPTY}"

# --- state-field fallback (gh sometimes only sets .state) -------------------
STATE_FAIL='[{"name":"unit","state":"failure"}]'
STATE_SUCCESS='[{"name":"unit","state":"success"}]'
run_case "state=failure blocks" 20 "red" "${STATE_FAIL}"
run_case "state=success passes" 0 "green" "${STATE_SUCCESS}"

# --- pending exhausts wait budget → blocked --------------------------------
PENDING='[{"name":"build","bucket":"pass"},{"name":"slow","bucket":"pending"}]'
run_case "still-pending after budget blocks" 20 "red" "${PENDING}"

# --- env CI_GATE_KNOWN_RED extends the allowlist ---------------------------
FLAKY='[{"name":"flaky-e2e","bucket":"fail"},{"name":"build","bucket":"pass"}]'
out="$(CI_GATE_KNOWN_RED="flaky-e2e" CI_GATE_CHECKS_CMD="printf '%s' '${FLAKY}'" bash "${GATE}" 99 2>/dev/null)"
got=$?
if [[ "${got}" -eq 0 ]]; then
  echo "[test] OK env CI_GATE_KNOWN_RED allowlists flaky-e2e → exit 0"
else
  echo "[test] FAIL env CI_GATE_KNOWN_RED: expected exit 0, got ${got} (out: ${out})"
  fail=1
fi
# without the env override the same red blocks
run_case "flaky-e2e blocks without env allowlist" 20 "red" "${FLAKY}"

# --- usage error ------------------------------------------------------------
bash "${GATE}" >/dev/null 2>&1
uerr=$?
if [[ "${uerr}" -eq 64 ]]; then
  echo "[test] OK missing pr_number → exit 64"
else
  echo "[test] FAIL usage: expected exit 64, got ${uerr}"
  fail=1
fi

# --- chronically-red detection emits a candidate warning -------------------
# Three distinct PRs with the same non-allowlisted red check → candidate log.
export CI_GATE_RED_HISTORY="${sandbox}/chronic-history.jsonl"
export CI_GATE_CHRONIC_K=3
: > "${CI_GATE_RED_HISTORY}"
CHRONIC='[{"name":"depcruise-new","bucket":"fail"}]'
for pr in 101 102; do
  CI_GATE_CHECKS_CMD="printf '%s' '${CHRONIC}'" bash "${GATE}" "${pr}" >/dev/null 2>&1
done
warn="$(CI_GATE_CHECKS_CMD="printf '%s' '${CHRONIC}'" bash "${GATE}" 103 2>&1 >/dev/null)"
if printf '%s' "${warn}" | grep -q "chronically-red candidate: 'depcruise-new'"; then
  echo "[test] OK chronically-red candidate detected after 3 PRs"
else
  echo "[test] FAIL chronic detection: no candidate warning (stderr: ${warn})"
  fail=1
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "[test] ci-gate: SOME TESTS FAILED"
  exit 1
fi
echo "[test] ci-gate: ALL TESTS PASSED"
