#!/usr/bin/env bash
# SessionStart hook:
#  1. STOP 파일 검사
#  2. spend.json 자정 자동 리셋 (current.date != today → history archive)
#  3. daily / weekly / research_daily 예산 95% 도달 시 STOP
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

# spend.json + jq 가능 시 자동 리셋 + 예산 검사
if [[ -f "$SPEND_FILE" ]] && command -v jq >/dev/null 2>&1; then
  today="$(date +%Y-%m-%d)"

  # 자정 자동 리셋: current.date != today 면 archive 후 새 날짜로 초기화
  current_date=$(jq -r '.current.date // "null"' "$SPEND_FILE")
  if [[ "$current_date" != "null" && "$current_date" != "$today" ]]; then
    tmp="$(mktemp)"
    jq --arg today "$today" '
      .history += [.current]
      | .current = { date: $today, tokens_input: 0, tokens_output: 0, cost_usd: 0, research_cost_usd: 0 }
    ' "$SPEND_FILE" > "$tmp" && mv "$tmp" "$SPEND_FILE" || rm -f "$tmp"
  fi

  daily_budget=$(jq -r '.daily_budget_usd // 50' "$SPEND_FILE")
  weekly_budget=$(jq -r '.weekly_budget_usd // 200' "$SPEND_FILE")
  research_budget=$(jq -r '.research_daily_budget_usd // 5' "$SPEND_FILE")

  current_cost=$(jq -r '.current.cost_usd // 0' "$SPEND_FILE")
  research_cost=$(jq -r '.current.research_cost_usd // 0' "$SPEND_FILE")

  # 최근 7일 (history) + current 합계
  weekly_cost=$(jq -r --arg today "$today" '
    ([ .history[]?
       | select(.date != null)
       | select(((($today | strptime("%Y-%m-%d") | mktime) -
                 (.date    | strptime("%Y-%m-%d") | mktime)) / 86400) < 7)
       | (.cost_usd // 0)
     ] + [ .current.cost_usd // 0 ]) | add // 0
  ' "$SPEND_FILE" 2>/dev/null || echo "$current_cost")

  emit_stop() {
    local reason="$1" sys="$2"
    cat <<JSON
{
  "continue": false,
  "stopReason": "$reason",
  "systemMessage": "$sys"
}
JSON
    exit 0
  }

  ratio_d=$(awk -v c="$current_cost"  -v b="$daily_budget"    'BEGIN { printf "%.2f", (b>0)?c/b:0 }')
  ratio_w=$(awk -v c="$weekly_cost"   -v b="$weekly_budget"   'BEGIN { printf "%.2f", (b>0)?c/b:0 }')
  ratio_r=$(awk -v c="$research_cost" -v b="$research_budget" 'BEGIN { printf "%.2f", (b>0)?c/b:0 }')

  if awk -v r="$ratio_d" 'BEGIN { exit !(r >= 0.95) }'; then
    emit_stop "Daily budget exceeded: \$${current_cost} / \$${daily_budget} (${ratio_d})" \
              "💰 Daily budget threshold reached. Halting."
  fi
  if awk -v r="$ratio_w" 'BEGIN { exit !(r >= 0.95) }'; then
    emit_stop "Weekly budget exceeded: \$${weekly_cost} / \$${weekly_budget} (${ratio_w})" \
              "💰 Weekly budget threshold reached. Halting."
  fi
  if awk -v r="$ratio_r" 'BEGIN { exit !(r >= 0.95) }'; then
    emit_stop "Research daily budget exceeded: \$${research_cost} / \$${research_budget} (${ratio_r})" \
              "🔬 Research daily budget threshold reached. Halting."
  fi
fi

exit 0
