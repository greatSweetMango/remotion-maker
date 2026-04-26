---
title: Reports
created: 2026-04-26
updated: 2026-04-26
tags: [meta, report]
status: active
---

# 📣 Reports

작업 상황·진행 상황·세션 결과를 **요약 보고하는 문서**를 모아두는 곳.
다른 폴더(`02-dev/status`, ADR, tech-notes 등)에도 반영되지만, **빠르게 "지금 무슨 일이 있었나"를 훑을 때는 여기를 먼저 본다.**

## 무엇이 들어가나

- 세션 단위 작업 보고 (Claude Code/agent가 작성한 작업 결과)
- 일/주/스프린트 단위 진행 보고
- 빌드/배포/릴리스 보고
- 회의 요약본 (원본 회의록은 `01-pm/meetings/`에)
- 인시던트/장애 사후 보고

## 3 계층 리포트 (에이전트 컴퍼니)

| 계층 | 종류 | 주기 | 작성자 | 위치 |
|---|---|---|---|---|
| **Micro** | task 회고 | build-team 1회 실행 후 | `team-retrospective` 스킬 | `2026-MM-DD-task-{id}-retro.md` |
| **Meso** | 세션 종합 | 사용자 1세션 종료 후 | Orchestrator (Stop hook) | `2026-MM-DD-session-{slug}.md` |
| **Macro** | 워크플로우 메타 분석 | 주간 (일요일) / 월간 (월말) | 메타 분석 팀 (Researcher+Architect+Validator) | `weekly/2026-Wnn.md`, `monthly/2026-MM.md` |

상세는 [[../02-dev/agent-company-blueprint#7-리포트-시스템\|Blueprint §7]] 참고.

## 무엇이 들어가지 않나

- 결정 그 자체 → `01-pm/decisions/` (ADR)
- 트러블슈팅 디테일 → `02-dev/tech-notes/`
- 미정리 메모 → `00-inbox/`

여기는 **"읽는" 문서**다. 출처/원본 링크를 항상 같이 적어 추적 가능하게 한다.

## 파일명 규칙

- `YYYY-MM-DD-종류-슬러그.md`
- 종류 예: `session`, `weekly`, `release`, `incident`, `meeting-summary`
- 예시
    - `2026-04-26-session-studio-ux.md`
    - `2026-W17-weekly.md`
    - `2026-05-03-release-v1.0.md`

## 포맷

`_meta/templates/report.md` 사용. 핵심 섹션:

1. 한 줄 요약 (TL;DR)
2. 무엇이 바뀌었나 (변경 목록)
3. 왜 (배경/동기)
4. 영향 / 후속 조치
5. 출처 링크 (코드, ADR, 회의록, status, REPORT.md 등)

## 인덱스 (최신순)

```dataview
TABLE created as "Date", tags, status
FROM "05-reports"
WHERE file.name != "README"
SORT created DESC
```

## 관련

- [[../02-dev/status|개발 현황 (live)]] — 현재 시점 단일 페이지
- [[../01-pm/decisions/README|ADR 인덱스]] — 결정 기록
- [[../01-pm/meetings/README|Meetings]] — 회의록 원본
