#!/usr/bin/env bash
# SessionStart hook (agent-company):
#  1. STOP 파일 검사 — 존재 시 세션 차단
#  2. spend.json 자정 자동 archive (current.date != today → history)
#  3. daily / weekly / research_daily 예산 95% 도달 시 STOP
#
# 상태 위치: $CLAUDE_PROJECT_DIR/.agent-state/  (없으면 무음 통과)
# 의존성: jq (없으면 예산 검사 skip — STOP 만 작동)
set -euo pipefail

# CLAUDE_PROJECT_DIR 는 Claude Code가 주입하는 프로젝트 루트. 없으면 cwd 기반 추정.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.agent-state"
STOP_FILE="$STATE_DIR/STOP"
SPEND_FILE="$STATE_DIR/spend.json"

# 1) STOP 검사
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

# 2~3) 예산 — jq + spend.json 가능할 때만
if [[ -f "$SPEND_FILE" ]] && command -v jq >/dev/null 2>&1; then
  today="$(date +%Y-%m-%d)"

  # 자정 자동 archive
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
