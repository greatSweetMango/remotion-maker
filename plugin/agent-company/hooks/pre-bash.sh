#!/usr/bin/env bash
# PreToolUse(Bash) hook: 위험한 명령 차단
# 입력: stdin JSON { tool_input: { command: "..." } }
# 차단:
#   - git push --force / --force-with-lease
#   - --no-verify (pre-commit hook 우회 금지)
#   - rm -rf / | ~ | /Users (광범위 삭제)
#   - main/master 브랜치 직접 push
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

cmd="$(jq -r '.tool_input.command // ""' 2>/dev/null || echo "")"

block() {
  cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "$1"
  }
}
JSON
  exit 0
}

# 차단 패턴
case "$cmd" in
  *"git push"*"--force"*|*"git push"*"-f "*|*"git push -f"|*"--force-with-lease"*)
    block "force push 차단 (히스토리 손실 위험). 사용자에게 명시적으로 허용 받은 경우에만 본 hook을 우회하세요."
    ;;
  *"--no-verify"*)
    block "--no-verify 차단 (pre-commit hook 우회 금지)"
    ;;
  *"rm -rf /"*|*"rm -rf ~"*|*"rm -rf /Users"*|*"rm -rf /home"*)
    block "광범위 rm -rf 차단"
    ;;
  *"git push origin main"*|*"git push origin master"*)
    block "main/master 직접 푸시 차단 — PR을 통해 머지하세요"
    ;;
esac

# git push가 main/master 브랜치를 푸시하려는지 추가 검사
if echo "$cmd" | grep -qE 'git[[:space:]]+push'; then
  current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
  if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
    block "현재 브랜치가 $current_branch 입니다. feature 브랜치에서만 push 허용."
  fi
fi

exit 0
