#!/usr/bin/env bash
# Stop hook: 세션 종료 시 status.md 안내, 미커밋 변경 경고
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$REPO_ROOT" 2>/dev/null || exit 0

# 미커밋 변경 검사
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  cat <<JSON
{
  "systemMessage": "⚠️ 미커밋 변경이 있습니다. \`git status\`로 확인하세요."
}
JSON
  exit 0
fi

exit 0
