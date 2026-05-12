#!/usr/bin/env bash
# TM-118 — Unit tests for scripts/orchestrator/rotate-spend-ledger.mjs.
#
# Cases
#   1. mixed-month ledger → past months archived as .gz, current month retained
#   2. ledger missing      → noop (status=noop, reason=ledger_missing)
#   3. all rows in current month → noop (status=noop, reason=no_old_rows)
#   4. idempotent: second run is noop
#   5. malformed lines stay in live ledger; valid past rows still rotate
#   6. multiple past months → one archive .gz per month, sorted
#   7. --dry-run does not mutate files
#
# Isolation: each case operates inside its own tempdir; --ledger / --archive-dir /
# --state flags point at sandbox paths.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${HERE}/scripts/orchestrator/rotate-spend-ledger.mjs"

[[ -f "${SCRIPT}" ]] || { echo "[test] FAIL: ${SCRIPT} missing"; exit 1; }
command -v node >/dev/null || { echo "[test] FAIL: node missing"; exit 1; }
command -v gunzip >/dev/null || { echo "[test] FAIL: gunzip missing"; exit 1; }

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" got="$2" want="$3"
  if [[ "${got}" == "${want}" ]]; then
    echo "[test] OK ${desc}"; PASS=$((PASS+1))
  else
    echo "[test] FAIL ${desc}: got=<${got}> want=<${want}>"; FAIL=$((FAIL+1))
  fi
}

# Use a fixed cutoff month so tests are deterministic.
CUTOFF="2026-05"

new_sandbox() {
  local d
  d="$(mktemp -d -t rotate-ledger.XXXXXX)"
  mkdir -p "${d}/.agent-state"
  printf '%s' "${d}"
}

run_rotate() {
  local sandbox="$1" extra="${2:-}"
  ( cd "${sandbox}" && node "${SCRIPT}" \
      --ledger=.agent-state/spend-ledger.jsonl \
      --archive-dir=.agent-state \
      --state=.agent-state/spend-ledger.rotate.json \
      --cutoff-month="${CUTOFF}" \
      --json \
      ${extra} ) 2>/dev/null
}

# ─── Case 1: mixed-month ledger ───────────────────────────────────────────────
SBX="$(new_sandbox)"
cat > "${SBX}/.agent-state/spend-ledger.jsonl" <<'EOF'
{"ts":"2026-03-12T01:00:00.000Z","task_id":"TM-100","model":"gpt-4o","tokens_in":10,"tokens_out":5,"cost_usd":0.001,"kind":"openai"}
{"ts":"2026-04-01T12:34:56.000Z","task_id":"TM-101","model":"claude-sonnet-4-5","tokens_in":50,"tokens_out":20,"cost_usd":0.002,"kind":"anthropic"}
{"ts":"2026-04-30T23:59:00.000Z","task_id":"TM-104","model":"claude-haiku","tokens_in":100,"tokens_out":40,"cost_usd":0.003,"kind":"anthropic"}
{"ts":"2026-05-01T00:00:01.000Z","task_id":"TM-112","model":"claude-sonnet-4-5","tokens_in":5,"tokens_out":5,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-05-10T10:10:10.000Z","task_id":"TM-118","model":"gpt-4o-mini","tokens_in":1,"tokens_out":1,"cost_usd":0.000001,"kind":"openai"}
EOF
OUT="$(run_rotate "${SBX}")"
STATUS="$(echo "${OUT}" | jq -r .status)"
assert_eq "case1.status" "${STATUS}" "rotated"
KEPT="$(echo "${OUT}" | jq -r .kept)"
assert_eq "case1.kept" "${KEPT}" "2"
ARCH_COUNT="$(echo "${OUT}" | jq -r '.archived | length')"
assert_eq "case1.archive-months" "${ARCH_COUNT}" "2"
# Live ledger must only contain current-month rows.
LIVE_LINES=$(wc -l < "${SBX}/.agent-state/spend-ledger.jsonl" | tr -d ' ')
assert_eq "case1.live-lines" "${LIVE_LINES}" "2"
# Archive .gz exists per month.
[[ -f "${SBX}/.agent-state/spend-ledger.archive.2026-03.jsonl.gz" ]] && \
  { echo "[test] OK case1.archive-2026-03-exists"; PASS=$((PASS+1)); } || \
  { echo "[test] FAIL case1.archive-2026-03-exists"; FAIL=$((FAIL+1)); }
[[ -f "${SBX}/.agent-state/spend-ledger.archive.2026-04.jsonl.gz" ]] && \
  { echo "[test] OK case1.archive-2026-04-exists"; PASS=$((PASS+1)); } || \
  { echo "[test] FAIL case1.archive-2026-04-exists"; FAIL=$((FAIL+1)); }
# Decompressed archive content should match the rotated rows.
GOT03="$(gunzip -c "${SBX}/.agent-state/spend-ledger.archive.2026-03.jsonl.gz" | jq -r .task_id | tr '\n' ',' )"
assert_eq "case1.archive-2026-03-rows" "${GOT03}" "TM-100,"
GOT04="$(gunzip -c "${SBX}/.agent-state/spend-ledger.archive.2026-04.jsonl.gz" | jq -r .task_id | tr '\n' ',' )"
assert_eq "case1.archive-2026-04-rows" "${GOT04}" "TM-101,TM-104,"
# Live ledger task_ids
LIVE_IDS="$(jq -r .task_id "${SBX}/.agent-state/spend-ledger.jsonl" | tr '\n' ',')"
assert_eq "case1.live-task-ids" "${LIVE_IDS}" "TM-112,TM-118,"
rm -rf "${SBX}"

# ─── Case 2: ledger missing → noop ────────────────────────────────────────────
SBX="$(new_sandbox)"
OUT="$(run_rotate "${SBX}")"
STATUS="$(echo "${OUT}" | jq -r .status)"
REASON="$(echo "${OUT}" | jq -r .reason)"
assert_eq "case2.status" "${STATUS}" "noop"
assert_eq "case2.reason" "${REASON}" "ledger_missing"
rm -rf "${SBX}"

# ─── Case 3: all rows current month → noop ────────────────────────────────────
SBX="$(new_sandbox)"
cat > "${SBX}/.agent-state/spend-ledger.jsonl" <<'EOF'
{"ts":"2026-05-01T00:00:00.000Z","task_id":"TM-A","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-05-09T23:59:59.000Z","task_id":"TM-B","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
EOF
OUT="$(run_rotate "${SBX}")"
STATUS="$(echo "${OUT}" | jq -r .status)"
REASON="$(echo "${OUT}" | jq -r .reason)"
assert_eq "case3.status" "${STATUS}" "noop"
assert_eq "case3.reason" "${REASON}" "no_old_rows"
# Live ledger untouched.
LIVE_LINES=$(wc -l < "${SBX}/.agent-state/spend-ledger.jsonl" | tr -d ' ')
assert_eq "case3.live-lines" "${LIVE_LINES}" "2"
rm -rf "${SBX}"

# ─── Case 4: idempotent — second run is noop ──────────────────────────────────
SBX="$(new_sandbox)"
cat > "${SBX}/.agent-state/spend-ledger.jsonl" <<'EOF'
{"ts":"2026-04-15T00:00:00.000Z","task_id":"TM-OLD","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-05-02T00:00:00.000Z","task_id":"TM-NEW","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
EOF
OUT1="$(run_rotate "${SBX}")"
S1="$(echo "${OUT1}" | jq -r .status)"
assert_eq "case4.first-run" "${S1}" "rotated"
OUT2="$(run_rotate "${SBX}")"
S2="$(echo "${OUT2}" | jq -r .status)"
R2="$(echo "${OUT2}" | jq -r .reason)"
assert_eq "case4.second-run-status" "${S2}" "noop"
assert_eq "case4.second-run-reason" "${R2}" "no_old_rows"
# Archive still has exactly one TM-OLD row (no duplicate from second run).
GOT="$(gunzip -c "${SBX}/.agent-state/spend-ledger.archive.2026-04.jsonl.gz" | jq -r .task_id | tr '\n' ',' )"
assert_eq "case4.archive-no-dup" "${GOT}" "TM-OLD,"
rm -rf "${SBX}"

# ─── Case 5: malformed lines preserved in live ledger ─────────────────────────
SBX="$(new_sandbox)"
cat > "${SBX}/.agent-state/spend-ledger.jsonl" <<'EOF'
not-a-json-line
{"ts":"2026-03-01T00:00:00.000Z","task_id":"TM-OLD","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-05-01T00:00:00.000Z","task_id":"TM-CUR","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
EOF
OUT="$(run_rotate "${SBX}")"
STATUS="$(echo "${OUT}" | jq -r .status)"
assert_eq "case5.status" "${STATUS}" "rotated"
MALFORMED="$(echo "${OUT}" | jq -r .malformed)"
assert_eq "case5.malformed" "${MALFORMED}" "1"
# Live ledger keeps malformed + current row.
LIVE_LINES=$(wc -l < "${SBX}/.agent-state/spend-ledger.jsonl" | tr -d ' ')
assert_eq "case5.live-lines" "${LIVE_LINES}" "2"
rm -rf "${SBX}"

# ─── Case 6: multiple past months ─────────────────────────────────────────────
SBX="$(new_sandbox)"
cat > "${SBX}/.agent-state/spend-ledger.jsonl" <<'EOF'
{"ts":"2025-12-12T00:00:00.000Z","task_id":"TM-Y","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-01-05T00:00:00.000Z","task_id":"TM-J","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-02-22T00:00:00.000Z","task_id":"TM-F","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-04-30T00:00:00.000Z","task_id":"TM-A","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
EOF
OUT="$(run_rotate "${SBX}")"
ARCH_COUNT="$(echo "${OUT}" | jq -r '.archived | length')"
assert_eq "case6.month-count" "${ARCH_COUNT}" "4"
[[ -f "${SBX}/.agent-state/spend-ledger.archive.2025-12.jsonl.gz" ]] && \
  { echo "[test] OK case6.archive-2025-12"; PASS=$((PASS+1)); } || \
  { echo "[test] FAIL case6.archive-2025-12"; FAIL=$((FAIL+1)); }
[[ -f "${SBX}/.agent-state/spend-ledger.archive.2026-02.jsonl.gz" ]] && \
  { echo "[test] OK case6.archive-2026-02"; PASS=$((PASS+1)); } || \
  { echo "[test] FAIL case6.archive-2026-02"; FAIL=$((FAIL+1)); }
LIVE_LINES=$(wc -l < "${SBX}/.agent-state/spend-ledger.jsonl" 2>/dev/null | tr -d ' ' || echo 0)
assert_eq "case6.live-lines" "${LIVE_LINES}" "0"
rm -rf "${SBX}"

# ─── Case 7: --dry-run does not write ─────────────────────────────────────────
SBX="$(new_sandbox)"
cat > "${SBX}/.agent-state/spend-ledger.jsonl" <<'EOF'
{"ts":"2026-04-01T00:00:00.000Z","task_id":"TM-OLD","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
{"ts":"2026-05-01T00:00:00.000Z","task_id":"TM-NEW","model":"x","tokens_in":1,"tokens_out":1,"cost_usd":0.0001,"kind":"anthropic"}
EOF
CHKSUM_BEFORE="$(shasum "${SBX}/.agent-state/spend-ledger.jsonl" | awk '{print $1}')"
OUT="$(run_rotate "${SBX}" "--dry-run")"
STATUS="$(echo "${OUT}" | jq -r .status)"
assert_eq "case7.status" "${STATUS}" "dry_run"
CHKSUM_AFTER="$(shasum "${SBX}/.agent-state/spend-ledger.jsonl" | awk '{print $1}')"
assert_eq "case7.ledger-unchanged" "${CHKSUM_AFTER}" "${CHKSUM_BEFORE}"
# No archive file created.
if [[ ! -f "${SBX}/.agent-state/spend-ledger.archive.2026-04.jsonl.gz" ]]; then
  echo "[test] OK case7.no-archive-created"; PASS=$((PASS+1))
else
  echo "[test] FAIL case7.no-archive-created"; FAIL=$((FAIL+1))
fi
rm -rf "${SBX}"

echo
echo "─── rotate-spend-ledger tests: ${PASS} passed, ${FAIL} failed ───"
[[ "${FAIL}" -eq 0 ]] || exit 1
