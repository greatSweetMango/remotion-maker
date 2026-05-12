#!/usr/bin/env bash
# TM-101 — Unit test for scripts/orchestrator/stop-guard.mjs.
# Scenarios mock state/reports dirs + GIT_WORKTREE_LIST_CMD.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="${HERE}/orchestrator/stop-guard.mjs"

[[ -f "${GUARD}" ]] || { echo "[test] FAIL: ${GUARD} missing"; exit 1; }

PASS=0
FAIL=0

case_assert() {
  local desc="$1" want_exit="$2" want_signal="$3" json="$4"
  local got_exit
  got_exit=$(echo "$json" | node -e 'process.stdin.on("data",d=>process.stdout.write(""+(JSON.parse(d).fired||[]).map(f=>f.signal).join(",")))') || true
  # Above only used for signal extraction. exit is preserved by caller.
  if [[ -z "${want_signal}" ]]; then
    if [[ "${LAST_EXIT}" -eq "${want_exit}" ]]; then
      echo "[test] OK ${desc} → exit ${want_exit}"
      PASS=$((PASS+1)); return
    fi
  else
    if [[ "${LAST_EXIT}" -eq "${want_exit}" && "$(echo "$json" | grep -o "${want_signal}" | head -1)" == "${want_signal}" ]]; then
      echo "[test] OK ${desc} → exit ${want_exit}, signal=${want_signal}"
      PASS=$((PASS+1)); return
    fi
  fi
  echo "[test] FAIL ${desc}: exit=${LAST_EXIT} want=${want_exit} signal_want=${want_signal} json=${json}"
  FAIL=$((FAIL+1))
}

run_guard() {
  local state_dir="$1" reports_dir="$2"
  set +e
  OUT=$(node "${GUARD}" --json --state-dir="${state_dir}" --reports-dir="${reports_dir}" 2>/dev/null | tail -1)
  LAST_EXIT=$?
  set -e
}

# ─── Setup base sandbox ────────────────────────────────────────────────────
SANDBOX="$(mktemp -d -t stop-guard-test.XXXXXX)"
trap 'rm -rf "${SANDBOX}"' EXIT

# Case 1: clean state — no signals fire
mkdir -p "${SANDBOX}/c1/state" "${SANDBOX}/c1/reports"
echo '{}' > "${SANDBOX}/c1/state/branch-locks.json"
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n\nworktree /b\n"' \
  run_guard "${SANDBOX}/c1/state" "${SANDBOX}/c1/reports"
case_assert "clean state" 0 "" "$OUT"

# Case 2: quality plateau — 3 reports with mode_match_pct within 0.5pp
mkdir -p "${SANDBOX}/c2/state" "${SANDBOX}/c2/reports"
for i in 1 2 3; do
  cat > "${SANDBOX}/c2/reports/2026-05-1${i}-bench.md" <<EOF
# bench $i
mode_match_pct: 87.${i}
EOF
done
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n"' \
  run_guard "${SANDBOX}/c2/state" "${SANDBOX}/c2/reports"
case_assert "quality plateau" 42 "quality_plateau" "$OUT"

# Case 3: error rate spike — 5 verdicts, 4 BLOCK
mkdir -p "${SANDBOX}/c3/state" "${SANDBOX}/c3/reports"
{
  echo '{"ts":"2026-05-13T00:00:00Z","task_id":"TM-1","verdict":"BLOCK"}'
  echo '{"ts":"2026-05-13T01:00:00Z","task_id":"TM-2","verdict":"BLOCK"}'
  echo '{"ts":"2026-05-13T02:00:00Z","task_id":"TM-3","verdict":"REQUEST_CHANGES"}'
  echo '{"ts":"2026-05-13T03:00:00Z","task_id":"TM-4","verdict":"BLOCK"}'
  echo '{"ts":"2026-05-13T04:00:00Z","task_id":"TM-5","verdict":"APPROVE"}'
} > "${SANDBOX}/c3/state/verdict-history.jsonl"
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n"' \
  run_guard "${SANDBOX}/c3/state" "${SANDBOX}/c3/reports"
case_assert "error rate spike" 42 "error_rate_spike" "$OUT"

# Case 4: worktree leak (≥5)
mkdir -p "${SANDBOX}/c4/state" "${SANDBOX}/c4/reports"
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n\nworktree /b\n\nworktree /c\n\nworktree /d\n\nworktree /e\n"' \
  run_guard "${SANDBOX}/c4/state" "${SANDBOX}/c4/reports"
case_assert "worktree leak" 42 "worktree_leak" "$OUT"

# Case 5: stale lock — started_at 10h ago
mkdir -p "${SANDBOX}/c5/state" "${SANDBOX}/c5/reports"
TEN_HRS_AGO=$(node -e "console.log(new Date(Date.now()-10*3600*1000).toISOString())")
cat > "${SANDBOX}/c5/state/branch-locks.json" <<EOF
{ "TM-99": { "branch": "x", "worktree": "y", "started_at": "${TEN_HRS_AGO}" } }
EOF
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n"' \
  run_guard "${SANDBOX}/c5/state" "${SANDBOX}/c5/reports"
case_assert "stale lock" 42 "stale_lock" "$OUT"

# Case 6: cost burst — ledger has $4 in last hour
mkdir -p "${SANDBOX}/c6/state" "${SANDBOX}/c6/reports"
NOW_ISO=$(node -e "console.log(new Date().toISOString())")
{
  echo "{\"ts\":\"${NOW_ISO}\",\"task_id\":\"TM-X\",\"model\":\"gpt-4o\",\"tokens_in\":1,\"tokens_out\":1,\"cost_usd\":2.5,\"kind\":\"openai\"}"
  echo "{\"ts\":\"${NOW_ISO}\",\"task_id\":\"TM-Y\",\"model\":\"gpt-4o\",\"tokens_in\":1,\"tokens_out\":1,\"cost_usd\":1.6,\"kind\":\"openai\"}"
} > "${SANDBOX}/c6/state/spend-ledger.jsonl"
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n"' \
  run_guard "${SANDBOX}/c6/state" "${SANDBOX}/c6/reports"
case_assert "cost burst" 42 "cost_burst" "$OUT"

# Case 7: STOP file already exists — guard preserves it, still exits 42
mkdir -p "${SANDBOX}/c7/state" "${SANDBOX}/c7/reports"
echo "pre-existing reason" > "${SANDBOX}/c7/state/STOP"
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n\nworktree /b\n\nworktree /c\n\nworktree /d\n\nworktree /e\n"' \
  run_guard "${SANDBOX}/c7/state" "${SANDBOX}/c7/reports"
case_assert "pre-existing STOP preserved" 42 "worktree_leak" "$OUT"
got_stop=$(cat "${SANDBOX}/c7/state/STOP")
if [[ "${got_stop}" == "pre-existing reason" ]]; then
  echo "[test] OK pre-existing STOP body preserved"; PASS=$((PASS+1))
else
  echo "[test] FAIL: STOP overwritten: ${got_stop}"; FAIL=$((FAIL+1))
fi

# Case 8: dry-run does not write STOP
mkdir -p "${SANDBOX}/c8/state" "${SANDBOX}/c8/reports"
set +e
GIT_WORKTREE_LIST_CMD='printf "worktree /a\n\nworktree /b\n\nworktree /c\n\nworktree /d\n\nworktree /e\n"' \
  node "${GUARD}" --dry-run --json \
    --state-dir="${SANDBOX}/c8/state" \
    --reports-dir="${SANDBOX}/c8/reports" >/dev/null 2>&1
DR_EXIT=$?
set -e
if [[ "${DR_EXIT}" -eq 42 && ! -f "${SANDBOX}/c8/state/STOP" ]]; then
  echo "[test] OK dry-run did not write STOP"; PASS=$((PASS+1))
else
  echo "[test] FAIL dry-run: exit=${DR_EXIT} STOP=$(ls "${SANDBOX}/c8/state/" 2>/dev/null)"; FAIL=$((FAIL+1))
fi

echo
echo "─── stop-guard tests: ${PASS} passed, ${FAIL} failed ───"
[[ "${FAIL}" -eq 0 ]] || exit 1
