#!/usr/bin/env bash
# PostToolUse hook: Anthropic + OpenAI API 호출의 usage 추출 → spend.json 누적
# 가격표: Claude 4.5 (Opus/Sonnet/Haiku) + gpt-4o / gpt-4o-mini / gpt-4.1
# flock 으로 동시 갱신 직렬화. 실패해도 도구 흐름 차단 X (항상 exit 0).
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.agent-state"
SPEND_FILE="$STATE_DIR/spend.json"
LOCK_FILE="$STATE_DIR/.spend.lock"

command -v jq >/dev/null 2>&1 || exit 0
[[ -f "$SPEND_FILE" ]] || exit 0

payload="$(cat || true)"
[[ -z "$payload" ]] && exit 0

# usage 블록 추출
usage_json="$(printf '%s' "$payload" | jq -c '
  ( .tool_response.usage
  // .tool_response.message.usage
  // .tool_response.response.usage
  // .response.usage
  // empty )
' 2>/dev/null || echo "")"

[[ -z "$usage_json" || "$usage_json" == "null" ]] && exit 0

# 모델 추출
model_raw="$(printf '%s' "$payload" | jq -r '
  ( .tool_response.model
  // .tool_response.message.model
  // .tool_response.response.model
  // .response.model
  // "" )
' 2>/dev/null || echo "")"

model_lower="$(printf '%s' "$model_raw" | tr '[:upper:]' '[:lower:]')"

# Provider / family
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

# 가격 (USD per 1M tokens)
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

# Token 추출 (Anthropic + OpenAI 양쪽 호환)
input_tokens=$(printf '%s' "$usage_json"      | jq -r '(.input_tokens // .prompt_tokens // 0)')
output_tokens=$(printf '%s' "$usage_json"     | jq -r '(.output_tokens // .completion_tokens // 0)')
cache_read=$(printf '%s' "$usage_json"        | jq -r '.cache_read_input_tokens // 0')
cache_creation=$(printf '%s' "$usage_json"    | jq -r '.cache_creation_input_tokens // 0')

# 비용 (USD)
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
