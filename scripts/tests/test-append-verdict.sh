#!/usr/bin/env bash
# TM-113 — Unit test for scripts/orchestrator/append-verdict.sh.
# Covers 5 verdict-pattern mocks + validation + concurrent appends.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${HERE}/orchestrator/append-verdict.sh"

[[ -x "${SCRIPT}" ]] || { echo "[test] FAIL: ${SCRIPT} missing or non-exec"; exit 1; }

PASS=0
FAIL=0

note_ok()   { echo "[test] OK   $*";   PASS=$((PASS+1)); }
note_fail() { echo "[test] FAIL $*";   FAIL=$((FAIL+1)); }

SANDBOX="$(mktemp -d -t append-verdict-test.XXXXXX)"
trap 'rm -rf "${SANDBOX}"' EXIT

STATE_DIR="${SANDBOX}/state"
FILE="${STATE_DIR}/verdict-history.jsonl"

run() {
  STATE_DIR="${STATE_DIR}" bash "${SCRIPT}" "$@"
}

# ─── Case 1: 5 verdict patterns appended in sequence ───────────────────────
patterns=(
  "TM-1 APPROVE"
  "TM-2 REQUEST_CHANGES"
  "TM-3 BLOCK"
  "113 APPROVE"            # bare numeric id → normalized to TM-113
  "TM-5 APPROVE"
)
for p in "${patterns[@]}"; do
  # shellcheck disable=SC2086
  run $p
done

lines=$(wc -l < "${FILE}" | tr -d ' ')
if [[ "${lines}" -eq 5 ]]; then
  note_ok "5 verdicts appended (line count)"
else
  note_fail "expected 5 lines, got ${lines}"
fi

# Each line must be valid JSON with required keys.
bad=0
while IFS= read -r ln; do
  echo "${ln}" | node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      const r = JSON.parse(d);
      if (!r.ts || !r.task_id || !r.verdict) process.exit(1);
      if (!/^TM-\d+$/.test(r.task_id)) process.exit(2);
      if (!["APPROVE","REQUEST_CHANGES","BLOCK"].includes(r.verdict)) process.exit(3);
    });
  ' || bad=$((bad+1))
done < "${FILE}"
if [[ "${bad}" -eq 0 ]]; then
  note_ok "all 5 lines parse as JSON with required schema"
else
  note_fail "${bad} malformed JSON line(s)"
fi

# Verdicts must match the order we wrote.
got_verdicts=$(node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split(/\n/).filter(Boolean);
  process.stdout.write(lines.map(l => JSON.parse(l).verdict).join(","));
' "${FILE}")
want="APPROVE,REQUEST_CHANGES,BLOCK,APPROVE,APPROVE"
if [[ "${got_verdicts}" == "${want}" ]]; then
  note_ok "verdict order preserved"
else
  note_fail "verdict order: got=${got_verdicts} want=${want}"
fi

# Bare-numeric id normalized to TM-113 (4th line).
got_id4=$(node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split(/\n/).filter(Boolean);
  process.stdout.write(JSON.parse(lines[3]).task_id);
' "${FILE}")
if [[ "${got_id4}" == "TM-113" ]]; then
  note_ok "bare numeric id normalized to TM-113"
else
  note_fail "id normalization: got=${got_id4} want=TM-113"
fi

# ─── Case 2: invalid verdict rejected ──────────────────────────────────────
set +e
STATE_DIR="${STATE_DIR}" bash "${SCRIPT}" TM-9 MAYBE 2>/dev/null
rc=$?
set -e
if [[ "${rc}" -eq 2 ]]; then
  note_ok "invalid verdict rejected (exit 2)"
else
  note_fail "invalid verdict: rc=${rc} want=2"
fi

# ─── Case 3: invalid task_id rejected ──────────────────────────────────────
set +e
STATE_DIR="${STATE_DIR}" bash "${SCRIPT}" not-a-task APPROVE 2>/dev/null
rc=$?
set -e
if [[ "${rc}" -eq 2 ]]; then
  note_ok "invalid task_id rejected (exit 2)"
else
  note_fail "invalid task_id: rc=${rc} want=2"
fi

# ─── Case 4: usage error when args missing ─────────────────────────────────
set +e
STATE_DIR="${STATE_DIR}" bash "${SCRIPT}" TM-1 2>/dev/null
rc=$?
set -e
if [[ "${rc}" -eq 2 ]]; then
  note_ok "missing arg rejected (exit 2)"
else
  note_fail "missing arg: rc=${rc} want=2"
fi

# ─── Case 5: concurrent appends preserve all lines (race safety) ───────────
STATE_DIR2="${SANDBOX}/state2"
mkdir -p "${STATE_DIR2}"
pids=()
for i in 1 2 3 4 5 6 7 8 9 10; do
  STATE_DIR="${STATE_DIR2}" bash "${SCRIPT}" "TM-${i}" APPROVE &
  pids+=("$!")
done
for p in "${pids[@]}"; do wait "${p}"; done
got=$(wc -l < "${STATE_DIR2}/verdict-history.jsonl" | tr -d ' ')
if [[ "${got}" -eq 10 ]]; then
  note_ok "10 concurrent appends → 10 lines (no race loss)"
else
  note_fail "concurrent: got=${got} want=10"
fi

# Each concurrent line must parse cleanly.
bad=0
while IFS= read -r ln; do
  echo "${ln}" | node -e '
    let d=""; process.stdin.on("data",c=>d+=c);
    process.stdin.on("end",()=>{ JSON.parse(d); });
  ' || bad=$((bad+1))
done < "${STATE_DIR2}/verdict-history.jsonl"
if [[ "${bad}" -eq 0 ]]; then
  note_ok "all concurrent lines well-formed (no torn writes)"
else
  note_fail "${bad} torn write(s) under concurrency"
fi

# ─── Summary ───────────────────────────────────────────────────────────────
echo
echo "[test] PASS=${PASS} FAIL=${FAIL}"
[[ "${FAIL}" -eq 0 ]] || exit 1
exit 0
