#!/usr/bin/env bash
# SessionStart hook: STOP 파일 검사 + 예산 초과 검사
# 둘 중 하나라도 트리거되면 systemMessage로 사용자에게 알리고 stopReason 반환
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STOP_FILE="$REPO_ROOT/.agent-state/STOP"
SPEND_FILE="$REPO_ROOT/.agent-state/spend.json"

if [[ -f "$STOP_FILE" ]]; then
  cat <<JSON
{
  "continue": false,
  "stopReason": "STOP file detected at $STOP_FILE — agent company halted. rm the file to resume.",
  "systemMessage": "🛑 STOP file present. Agent company will not run."
}
JSON
  exit 0
fi

# 예산 검사 (spend.json 존재 + jq 가능 시)
if [[ -f "$SPEND_FILE" ]] && command -v jq >/dev/null 2>&1; then
  daily_budget=$(jq -r '.daily_budget_usd // 50' "$SPEND_FILE")
  current_cost=$(jq -r '.current.cost_usd // 0' "$SPEND_FILE")
  ratio=$(awk -v c="$current_cost" -v b="$daily_budget" 'BEGIN { printf "%.2f", c/b }')

  if awk -v r="$ratio" 'BEGIN { exit !(r >= 0.95) }'; then
    cat <<JSON
{
  "continue": false,
  "stopReason": "Daily budget exceeded: \$${current_cost} / \$${daily_budget} (${ratio})",
  "systemMessage": "💰 Daily budget threshold reached. Halting."
}
JSON
    exit 0
  fi
fi

exit 0
