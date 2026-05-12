#!/usr/bin/env bash
# PreToolUse(Bash) hook: 위험한 명령 차단
# 입력: stdin JSON { tool_input: { command: "..." } }
set -euo pipefail

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
    block "force push 차단 (히스토리 손실 위험)"
    ;;
  *"--no-verify"*)
    block "--no-verify 차단 (pre-commit hook 우회 금지)"
    ;;
  *"rm -rf /"*|*"rm -rf ~"*|*"rm -rf /Users"*)
    block "광범위 rm -rf 차단"
    ;;
  *"git push origin main"*|*"git push origin master"*)
    # main 직접 푸시 차단 (PR을 통하도록)
    block "main/master 직접 푸시 차단 — PR을 통해 머지하세요"
    ;;
  *"git checkout main"*|*"git switch main"*)
    # 단순 체크아웃은 허용, 단 setup/agent-company-bootstrap 자체에 영향 없는 컨텍스트에서만
    # (이건 차단 안 함, 단지 예시)
    ;;
esac

# git push가 main 브랜치를 푸시하려는지 추가 검사
# TeamLead 워크트리 컨텍스트 대응: 명령 안의 `cd <worktree> &&` 또는 명시적
# `origin <branch>` 인자가 있으면 그쪽을 우선 신뢰.
if echo "$cmd" | grep -qE 'git[[:space:]]+push'; then
  target_branch=""

  # 1. `git push -u origin <branch>` 형태에서 브랜치 추출
  target_branch="$(printf '%s' "$cmd" | grep -oE 'git[[:space:]]+push([[:space:]]+-[uU])?[[:space:]]+origin[[:space:]]+[A-Za-z0-9._/-]+' | awk '{print $NF}' | head -1)"

  # 2. fallback: 명령 안의 `cd <path> &&` 가 worktree 를 가리키면 그 worktree 의 HEAD 사용
  if [[ -z "$target_branch" ]]; then
    cd_path="$(printf '%s' "$cmd" | grep -oE 'cd[[:space:]]+[^[:space:];&|]+' | awk '{print $2}' | head -1)"
    if [[ -n "$cd_path" && -d "$cd_path" ]]; then
      target_branch="$(git -C "$cd_path" symbolic-ref --short HEAD 2>/dev/null || echo "")"
    fi
  fi

  # 3. 최종 fallback: 현재 cwd 의 브랜치
  if [[ -z "$target_branch" ]]; then
    target_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
  fi

  if [[ "$target_branch" == "main" || "$target_branch" == "master" ]]; then
    block "push 타깃 브랜치가 main/master입니다. feature 브랜치에서만 push 허용."
  fi
fi

exit 0
