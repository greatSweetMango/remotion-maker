#!/usr/bin/env bash
# TM-112 — Unit test for .claude/hooks/post-tool-use.sh spend-ledger append.
# Feeds mock Claude Code PostToolUse payloads via stdin and asserts:
#   1. one JSONL line appended per Anthropic API response
#   2. one JSONL line appended per OpenAI API response
#   3. payload with no usage block → no line appended
#   4. task_id from CLAUDE_TASK_ID env wins; else .agent-state/current-task; else "unknown"
#   5. ledger schema matches TM-101: ts, task_id, model, tokens_in, tokens_out, cost_usd, kind
#
# Isolation: each case copies the hook into a temp sandbox whose own .agent-state/
# is the REPO_ROOT-relative ../../.agent-state. We achieve that by symlinking
# .claude/hooks → real hook and creating sandbox/.agent-state with seed spend.json.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REAL_HOOK="${HERE}/.claude/hooks/post-tool-use.sh"

[[ -f "${REAL_HOOK}" ]] || { echo "[test] FAIL: ${REAL_HOOK} missing"; exit 1; }
command -v jq >/dev/null || { echo "[test] FAIL: jq missing"; exit 1; }

PASS=0
FAIL=0

# Build an isolated copy of the hook tree per test:
#   $SANDBOX/.claude/hooks/post-tool-use.sh  (copy)
#   $SANDBOX/.agent-state/{spend.json,...}
new_sandbox() {
  local d
  d="$(mktemp -d -t spend-ledger-hook.XXXXXX)"
  mkdir -p "${d}/.claude/hooks" "${d}/.agent-state"
  cp "${REAL_HOOK}" "${d}/.claude/hooks/post-tool-use.sh"
  chmod +x "${d}/.claude/hooks/post-tool-use.sh"
  cat > "${d}/.agent-state/spend.json" <<'EOF'
{ "current": { "date": null, "tokens_input": 0, "tokens_output": 0, "cost_usd": 0, "research_cost_usd": 0 },
  "history": [], "openai_total_usd": 0 }
EOF
  printf '%s' "${d}"
}

run_hook() {
  local sandbox="$1" payload="$2"
  ( cd "${sandbox}" && printf '%s' "${payload}" | bash .claude/hooks/post-tool-use.sh ) || true
}

assert_eq() {
  local desc="$1" got="$2" want="$3"
  if [[ "${got}" == "${want}" ]]; then
    echo "[test] OK ${desc}"; PASS=$((PASS+1))
  else
    echo "[test] FAIL ${desc}: got=<${got}> want=<${want}>"; FAIL=$((FAIL+1))
  fi
}

assert_field() {
  local desc="$1" ledger="$2" field="$3" want="$4"
  local got; got="$(jq -r ".${field}" "${ledger}" 2>/dev/null | tail -1)"
  assert_eq "${desc}.${field}" "${got}" "${want}"
}

# ─── Case 1: Anthropic Sonnet response → 1 ledger line ─────────────────────
SBX="$(new_sandbox)"
PAYLOAD='{"tool_response":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}'
unset CLAUDE_TASK_ID
CLAUDE_TASK_ID="TM-112" run_hook "${SBX}" "${PAYLOAD}"
LEDGER="${SBX}/.agent-state/spend-ledger.jsonl"
LINES=$(wc -l < "${LEDGER}" 2>/dev/null | tr -d ' ' || echo 0)
assert_eq "case1.lines" "${LINES}" "1"
assert_field "case1" "${LEDGER}" "task_id"   "TM-112"
assert_field "case1" "${LEDGER}" "kind"      "anthropic"
assert_field "case1" "${LEDGER}" "model"     "claude-sonnet-4-5"
assert_field "case1" "${LEDGER}" "tokens_in" "1000"
assert_field "case1" "${LEDGER}" "tokens_out" "200"
# cost = (1000*3 + 200*15)/1e6 = 0.006
assert_field "case1" "${LEDGER}" "cost_usd"  "0.006000"
rm -rf "${SBX}"

# ─── Case 2: OpenAI gpt-4o response → 1 ledger line, kind=openai ───────────
SBX="$(new_sandbox)"
PAYLOAD='{"tool_response":{"model":"gpt-4o","usage":{"prompt_tokens":2000,"completion_tokens":500}}}'
CLAUDE_TASK_ID="TM-66" run_hook "${SBX}" "${PAYLOAD}"
LEDGER="${SBX}/.agent-state/spend-ledger.jsonl"
LINES=$(wc -l < "${LEDGER}" 2>/dev/null | tr -d ' ' || echo 0)
assert_eq "case2.lines" "${LINES}" "1"
assert_field "case2" "${LEDGER}" "kind"  "openai"
assert_field "case2" "${LEDGER}" "task_id" "TM-66"
assert_field "case2" "${LEDGER}" "model" "gpt-4o"
# cost = (2000*2.5 + 500*10)/1e6 = 0.01
assert_field "case2" "${LEDGER}" "cost_usd" "0.010000"
rm -rf "${SBX}"

# ─── Case 3: no usage block → no ledger line ───────────────────────────────
SBX="$(new_sandbox)"
PAYLOAD='{"tool_response":{"model":"claude-opus","output":"hello"}}'
CLAUDE_TASK_ID="TM-X" run_hook "${SBX}" "${PAYLOAD}"
LEDGER="${SBX}/.agent-state/spend-ledger.jsonl"
if [[ ! -f "${LEDGER}" ]]; then
  echo "[test] OK case3.no-ledger-file"; PASS=$((PASS+1))
else
  LINES=$(wc -l < "${LEDGER}" | tr -d ' ')
  if [[ "${LINES}" == "0" ]]; then
    echo "[test] OK case3.zero-lines"; PASS=$((PASS+1))
  else
    echo "[test] FAIL case3: unexpected ledger content"; cat "${LEDGER}"; FAIL=$((FAIL+1))
  fi
fi
rm -rf "${SBX}"

# ─── Case 4: task_id fallback chain ────────────────────────────────────────
# 4a: CLAUDE_TASK_ID wins over current-task file
SBX="$(new_sandbox)"
echo "TM-FROM-FILE" > "${SBX}/.agent-state/current-task"
PAYLOAD='{"tool_response":{"model":"claude-haiku","usage":{"input_tokens":10,"output_tokens":5}}}'
CLAUDE_TASK_ID="TM-FROM-ENV" run_hook "${SBX}" "${PAYLOAD}"
assert_field "case4a.env-wins" "${SBX}/.agent-state/spend-ledger.jsonl" "task_id" "TM-FROM-ENV"
rm -rf "${SBX}"

# 4b: no env → file
SBX="$(new_sandbox)"
echo "TM-FROM-FILE" > "${SBX}/.agent-state/current-task"
unset CLAUDE_TASK_ID
PAYLOAD='{"tool_response":{"model":"claude-haiku","usage":{"input_tokens":10,"output_tokens":5}}}'
run_hook "${SBX}" "${PAYLOAD}"
assert_field "case4b.file-fallback" "${SBX}/.agent-state/spend-ledger.jsonl" "task_id" "TM-FROM-FILE"
rm -rf "${SBX}"

# 4c: neither → "unknown"
SBX="$(new_sandbox)"
unset CLAUDE_TASK_ID
PAYLOAD='{"tool_response":{"model":"claude-haiku","usage":{"input_tokens":10,"output_tokens":5}}}'
run_hook "${SBX}" "${PAYLOAD}"
assert_field "case4c.unknown" "${SBX}/.agent-state/spend-ledger.jsonl" "task_id" "unknown"
rm -rf "${SBX}"

# ─── Case 5: schema completeness — all 7 fields present ────────────────────
SBX="$(new_sandbox)"
PAYLOAD='{"tool_response":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1,"output_tokens":1}}}'
CLAUDE_TASK_ID="TM-1" run_hook "${SBX}" "${PAYLOAD}"
KEYS="$(jq -r 'keys | join(",")' "${SBX}/.agent-state/spend-ledger.jsonl" | tail -1)"
assert_eq "case5.schema-keys" "${KEYS}" "cost_usd,kind,model,task_id,tokens_in,tokens_out,ts"
# ts must be ISO-8601
TS="$(jq -r '.ts' "${SBX}/.agent-state/spend-ledger.jsonl" | tail -1)"
if [[ "${TS}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.*Z$ ]]; then
  echo "[test] OK case5.ts-iso8601 (${TS})"; PASS=$((PASS+1))
else
  echo "[test] FAIL case5.ts-iso8601: got=${TS}"; FAIL=$((FAIL+1))
fi
rm -rf "${SBX}"

# ─── Case 6: two appends → two lines (append-only safety) ──────────────────
SBX="$(new_sandbox)"
PAYLOAD='{"tool_response":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1,"output_tokens":1}}}'
CLAUDE_TASK_ID="TM-A" run_hook "${SBX}" "${PAYLOAD}"
CLAUDE_TASK_ID="TM-B" run_hook "${SBX}" "${PAYLOAD}"
LINES=$(wc -l < "${SBX}/.agent-state/spend-ledger.jsonl" | tr -d ' ')
assert_eq "case6.two-appends" "${LINES}" "2"
T1="$(jq -r '.task_id' "${SBX}/.agent-state/spend-ledger.jsonl" | head -1)"
T2="$(jq -r '.task_id' "${SBX}/.agent-state/spend-ledger.jsonl" | tail -1)"
assert_eq "case6.line1.task_id" "${T1}" "TM-A"
assert_eq "case6.line2.task_id" "${T2}" "TM-B"
rm -rf "${SBX}"

echo
echo "─── spend-ledger hook tests: ${PASS} passed, ${FAIL} failed ───"
[[ "${FAIL}" -eq 0 ]] || exit 1
