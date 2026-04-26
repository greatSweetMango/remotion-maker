---
title: 'TM-19 Validation — spend.json autotrack hook'
created: 2026-04-26
updated: 2026-04-26
tags: [report, validation, infra, agent-company]
status: active
report_type: session
---

# TM-19 Validation

## Spec 매칭

| 요구사항 | 구현 | 상태 |
|---|---|---|
| post-tool-use.sh 신설 | `.claude/hooks/post-tool-use.sh` | ✅ |
| usage 4종 키 추출 | input/output/cache_read/cache_creation | ✅ |
| 모델별 가격 (Opus/Sonnet/Haiku 4.5) | family 자동 감지 + 단가표 | ✅ |
| spend.json 누적 | flock + jq atomic mv | ✅ |
| daily/weekly/research 카운터 | current.cost_usd / weekly(최근 7일 합) / research_cost_usd | ✅ |
| session-start.sh 95% STOP | daily/weekly/research 3종 게이트 | ✅ |
| 자정 자동 리셋 | current.date != today → history archive | ✅ |
| settings.json hook 등록 | PostToolUse matcher `.*` | ✅ |

## 안전 검토

- jq 미설치 → graceful degrade (exit 0)
- payload에 usage 없음 (Bash 등 비-API tool) → 무음 exit 0
- flock 미설치 → flock 분기 skip, 그래도 동작 (단, race 가능 — 단일 세션 가정 하에 허용)
- post-tool-use 실패 시 도구 흐름 보존 (set -uo pipefail, exit 0)

## 결정

APPROVE — spec 충족, side-effect 안전.

## 후속

- jq를 dev 환경 표준 의존성으로 추가할지 별도 task 검토 (현재는 graceful degrade로 충분)
- 가격표 변동 시 hook 내 case 단가만 수정 (단일 SoT)
