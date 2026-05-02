#!/usr/bin/env bash
# PostToolUse hook: Anthropic API 호출 응답에서 usage 추출 → spend.json 누적 갱신
# 입력: stdin JSON (Claude Code PostToolUse payload)
# 갱신: .agent-state/spend.json (daily/weekly/research counters)
# 실패해도 도구 흐름을 막지 않도록 항상 exit 0.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEND_FILE="$REPO_ROOT/.agent-state/spend.json"
LOCK_FILE="$REPO_ROOT/.agent-state/.spend.lock"

# 의존성 검사 — 없으면 무음 종료
command -v jq >/dev/null 2>&1 || exit 0
[[ -f "$SPEND_FILE" ]] || exit 0

# stdin 캡처
payload="$(cat || true)"
[[ -z "$payload" ]] && exit 0

# usage 블록 추출 — 가능한 경로들 시도
usage_json="$(printf '%s' "$payload" | jq -c '
  ( .tool_response.usage
  // .tool_response.message.usage
  // .tool_response.response.usage
  // .response.usage
  // empty )
' 2>/dev/null || echo "")"

[[ -z "$usage_json" || "$usage_json" == "null" ]] && exit 0

# 모델 추출 (대략적 매칭: opus|sonnet|haiku)
model_raw="$(printf '%s' "$payload" | jq -r '
  ( .tool_response.model
  // .tool_response.message.model
  // .tool_response.response.model
  // .response.model
  // "" )
' 2>/dev/null || echo "")"

model_lower="$(printf '%s' "$model_raw" | tr '[:upper:]' '[:lower:]')"

# Provider / family resolution. Anthropic models drive Claude pricing;
# OpenAI models (gpt-*) use the OpenAI table and feed `openai_total_usd`.
provider="anthropic"
case "$model_lower" in
  gpt-*|*o1*|*openai*) provider="openai" ;;
esac

model_family="sonnet"
if [[ "$provider" == "anthropic" ]]; then
  case "$model_lower" in
    *opus*)   model_family="opus"   ;;
    *sonnet*) model_family="sonnet" ;;
    *haiku*)  model_family="haiku"  ;;
  esac
fi

# 가격 (USD per 1M tokens). Anthropic: Claude 4.5 (Opus/Sonnet/Haiku);
# OpenAI: gpt-4o vs gpt-4o-mini (cache fields zeroed — OpenAI does not
# expose per-cache pricing in its usage payload yet).
if [[ "$provider" == "anthropic" ]]; then
  case "$model_family" in
    opus)   p_in=15;    p_out=75; p_cw=18.75; p_cr=1.5  ;;
    sonnet) p_in=3;     p_out=15; p_cw=3.75;  p_cr=0.30 ;;
    haiku)  p_in=1;     p_out=5;  p_cw=1.25;  p_cr=0.10 ;;
  esac
else
  case "$model_lower" in
    *gpt-4o-mini*)  p_in=0.15; p_out=0.60 ;;
    *gpt-4.1-mini*) p_in=0.4;  p_out=1.6  ;;
    *gpt-4.1*)      p_in=2;    p_out=8    ;;
    *gpt-4o*)       p_in=2.5;  p_out=10   ;;
    *)              p_in=0.15; p_out=0.60 ;;
  esac
  p_cw=0; p_cr=0
fi

# Token extraction — accept both Anthropic (input_tokens/output_tokens) and
# OpenAI (prompt_tokens/completion_tokens) shapes.
input_tokens=$(printf '%s' "$usage_json"      | jq -r '(.input_tokens // .prompt_tokens // 0)')
output_tokens=$(printf '%s' "$usage_json"     | jq -r '(.output_tokens // .completion_tokens // 0)')
cache_read=$(printf '%s' "$usage_json"        | jq -r '.cache_read_input_tokens // 0')
cache_creation=$(printf '%s' "$usage_json"    | jq -r '.cache_creation_input_tokens // 0')

# 비용 계산 (USD)
cost_usd=$(awk -v i="$input_tokens" -v o="$output_tokens" -v cr="$cache_read" -v cw="$cache_creation" \
  -v pi="$p_in" -v po="$p_out" -v pcr="$p_cr" -v pcw="$p_cw" \
  'BEGIN { printf "%.6f", (i*pi + o*po + cr*pcr + cw*pcw) / 1000000 }')

# research 플래그
is_research=0
if [[ "${CLAUDE_RESEARCH:-0}" == "1" ]]; then
  is_research=1
elif printf '%s' "$payload" | jq -e '.tool_input | tostring | test("research"; "i")' >/dev/null 2>&1; then
  is_research=1
fi

today="$(date +%Y-%m-%d)"

# spend.json 갱신 (flock 으로 직렬화)
mkdir -p "$(dirname "$LOCK_FILE")"
(
  if command -v flock >/dev/null 2>&1; then
    flock -w 5 9 || exit 0
  fi

  tmp="$(mktemp)"
  jq --arg today "$today" \
     --arg provider "$provider" \
     --argjson in_tok "$input_tokens" \
     --argjson out_tok "$output_tokens" \
     --argjson cost "$cost_usd" \
     --argjson research "$is_research" '
    # 날짜 변경 시 archive
    (if (.current.date != null) and (.current.date != $today) then
       .history += [.current]
       | .current = { date: $today, tokens_input: 0, tokens_output: 0, cost_usd: 0, research_cost_usd: 0 }
     else . end)
    | (if .current.date == null then .current.date = $today else . end)
    | .current.tokens_input  = ((.current.tokens_input  // 0) + $in_tok)
    | .current.tokens_output = ((.current.tokens_output // 0) + $out_tok)
    | .current.cost_usd      = (((.current.cost_usd     // 0) + $cost) | . * 1000000 | round / 1000000)
    | (if $research == 1 then
         .current.research_cost_usd = (((.current.research_cost_usd // 0) + $cost) | . * 1000000 | round / 1000000)
       else . end)
    | (if $provider == "openai" then
         .openai_total_usd = (((.openai_total_usd // 0) + $cost) | . * 1000000 | round / 1000000)
       else . end)
  ' "$SPEND_FILE" > "$tmp" 2>/dev/null && mv "$tmp" "$SPEND_FILE" || rm -f "$tmp"
) 9>"$LOCK_FILE"

exit 0
