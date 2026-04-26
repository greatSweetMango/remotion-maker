#!/usr/bin/env bash
# meta-analysis.sh — 주간/월간 워크플로우 메타 분석 진입점
#
# 사용법:
#   scripts/meta-analysis.sh weekly            # 직전 주(W17 등) 자동 계산
#   scripts/meta-analysis.sh monthly           # 직전 월 자동 계산
#   scripts/meta-analysis.sh weekly 2026-W17   # 명시적 라벨
#   scripts/meta-analysis.sh weekly 2026-W17 --force  # 기존 파일 덮어쓰기
#
# 호출 흐름:
#   launchd / cron → 본 스크립트 → claude -p (meta-analyzer 프롬프트 주입) → wiki/05-reports/<period>/<label>.md 생성 + commit
#
# 의존: bash, git, claude CLI, gh (선택), date(GNU 또는 BSD)
# blueprint §7 참조

set -euo pipefail

PERIOD="${1:-}"
LABEL_ARG="${2:-}"
FORCE_FLAG="${3:-}"

if [[ -z "$PERIOD" || ( "$PERIOD" != "weekly" && "$PERIOD" != "monthly" ) ]]; then
  echo "Usage: $0 <weekly|monthly> [label] [--force]" >&2
  exit 2
fi

# 저장소 루트로 이동 (스크립트는 어디서 호출되든 동작)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Wiki 소유권 = main (blueprint §3.5). main이 아니면 abort.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "[meta-analysis] WARN: not on main (current=$CURRENT_BRANCH). Wiki 소유권 정책 위반 위험." >&2
  echo "[meta-analysis] Continuing (스크립트 자체 테스트일 수 있음). cron 등록 시 main만 사용하세요." >&2
fi

# 날짜 계산: GNU/BSD date 호환 (macOS = BSD)
date_iso() {
  if date --version >/dev/null 2>&1; then
    date -u -d "$1" +"%Y-%m-%dT%H:%M:%SZ"   # GNU
  else
    date -u -j -f "%Y-%m-%d %H:%M:%S" "$1" +"%Y-%m-%dT%H:%M:%SZ"  # BSD
  fi
}

if [[ "$PERIOD" == "weekly" ]]; then
  if [[ -z "$LABEL_ARG" ]]; then
    # 직전 주: ISO week
    YEAR=$(date -u +"%G")
    WEEK=$(date -u +"%V")
    LABEL="${YEAR}-W${WEEK}"
  else
    LABEL="$LABEL_ARG"
  fi
  # 7일 전 ~ 지금
  if date --version >/dev/null 2>&1; then
    SINCE=$(date -u -d "7 days ago" +"%Y-%m-%dT%H:%M:%SZ")
    UNTIL=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  else
    SINCE=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ")
    UNTIL=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  fi
  OUT_DIR="wiki/05-reports/weekly"
else
  # monthly
  if [[ -z "$LABEL_ARG" ]]; then
    LABEL=$(date -u +"%Y-%m")
  else
    LABEL="$LABEL_ARG"
  fi
  if date --version >/dev/null 2>&1; then
    SINCE=$(date -u -d "1 month ago" +"%Y-%m-%dT%H:%M:%SZ")
    UNTIL=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  else
    SINCE=$(date -u -v-1m +"%Y-%m-%dT%H:%M:%SZ")
    UNTIL=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  fi
  OUT_DIR="wiki/05-reports/monthly"
fi

mkdir -p "$OUT_DIR"
OUT_PATH="$OUT_DIR/${LABEL}.md"

if [[ -f "$OUT_PATH" && "$FORCE_FLAG" != "--force" ]]; then
  echo "[meta-analysis] $OUT_PATH already exists. Pass --force to overwrite." >&2
  exit 3
fi

PROMPT_FILE="prompts/meta-analyzer.md"
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "[meta-analysis] missing $PROMPT_FILE" >&2
  exit 4
fi

LOG_DIR=".agent-state/meta-analysis-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${PERIOD}-${LABEL}-$(date -u +%Y%m%dT%H%M%SZ).log"

echo "[meta-analysis] period=$PERIOD label=$LABEL since=$SINCE until=$UNTIL out=$OUT_PATH"
echo "[meta-analysis] log=$LOG_FILE"

# 입력 데이터 미리보기 (Researcher 단계 일부 — claude가 수집할 컨텍스트 힌트)
{
  echo "## Pre-collected data"
  echo ""
  echo "### Retrospectives in window"
  find wiki/05-reports -maxdepth 1 -name "*-retro.md" -print 2>/dev/null || true
  echo ""
  echo "### Spend snapshot"
  cat .agent-state/spend.json 2>/dev/null || echo "(no spend.json)"
  echo ""
  echo "### Active branch locks"
  cat .agent-state/branch-locks.json 2>/dev/null || echo "(no branch-locks.json)"
  echo ""
  echo "### Git activity"
  git log --since="$SINCE" --until="$UNTIL" --pretty=format:"%h %ad %an %s" --date=short || true
  echo ""
} > "$LOG_FILE.preflight"

# Claude CLI 헤드리스 호출
# (claude CLI가 없으면 dry-run 모드로 스키마만 생성 — 첫 검증/CI 시나리오)
if ! command -v claude >/dev/null 2>&1; then
  echo "[meta-analysis] claude CLI not found — DRY-RUN: writing schema-only stub" >&2
  cat > "$OUT_PATH" <<EOF
---
title: "Workflow Meta-Analysis ${LABEL}"
period: ${PERIOD}
period_label: ${LABEL}
since: ${SINCE}
until: ${UNTIL}
created: $(date -u +%Y-%m-%d)
tags: [meta-analysis, agent-company, ${PERIOD}]
status: draft
tasks_completed: 0
tasks_failed: 0
escalations: 0
total_cost_usd: 0
data_volume: insufficient
generated_by: dry-run-stub
---

# Workflow Meta-Analysis — ${LABEL}

> DRY-RUN: claude CLI 미발견. 스키마 검증용 stub.

## 1. 정량 지표
데이터 부족 — 다음 주기부터 신뢰 가능.

## 2. 팀 소통 패턴
데이터 부족.

## 3. 병렬 작업 효율
데이터 부족.

## 4. 정확도 / 품질
데이터 부족.

## 5. 개선 제안
- [ ] (예시) cron 등록 후 다음 주기 데이터로 재실행

## 6. 리스크 / 적신호
없음 (데이터 부족).

## 7. 채택 / 기각
- [ ] N/A

## Appendix A: 원본 데이터 링크
- preflight log: ${LOG_FILE}.preflight
EOF
else
  # 실제 호출: claude -p로 메타 분석 실행
  CLAUDE_INPUT=$(cat <<EOF
PERIOD=${PERIOD}
PERIOD_LABEL=${LABEL}
SINCE_ISO=${SINCE}
UNTIL_ISO=${UNTIL}
OUT_PATH=${OUT_PATH}
PREFLIGHT_LOG=${LOG_FILE}.preflight

위 인자로 prompts/meta-analyzer.md의 절차를 수행하세요. 산출물은 ${OUT_PATH}에 작성하고, git add + commit ("report: meta-analysis ${PERIOD} ${LABEL}")까지 수행하세요. main 브랜치에서만 실행하세요.
EOF
)
  echo "$CLAUDE_INPUT" | claude -p --append-system-prompt "$(cat $PROMPT_FILE)" 2>&1 | tee "$LOG_FILE"
fi

# 산출물 검증 (스키마 최소 체크)
if [[ ! -f "$OUT_PATH" ]]; then
  echo "[meta-analysis] FAIL: $OUT_PATH not created" >&2
  exit 5
fi

REQUIRED_SECTIONS=("# 1. 정량 지표" "## 2. 팀 소통" "## 3. 병렬" "## 4. 정확도" "## 5. 개선 제안" "## 6. 리스크" "## 7. 채택")
MISSING=0
for sec in "${REQUIRED_SECTIONS[@]}"; do
  if ! grep -qF "$sec" "$OUT_PATH"; then
    # 헤더 레벨이 살짝 달라도 통과시키기 위해 키워드만 체크
    KEY="${sec##*. }"
    if ! grep -qF "$KEY" "$OUT_PATH"; then
      echo "[meta-analysis] WARN: missing section: $sec" >&2
      MISSING=$((MISSING+1))
    fi
  fi
done

if [[ "$MISSING" -gt 0 ]]; then
  echo "[meta-analysis] WARN: $MISSING section(s) missing. 사람 검토 필요." >&2
fi

echo "[meta-analysis] OK: $OUT_PATH"
exit 0
