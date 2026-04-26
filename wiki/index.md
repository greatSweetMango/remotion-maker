---
title: EasyMake Wiki — Home
created: 2026-04-26
updated: 2026-04-26
tags: [meta]
status: active
---

# EasyMake Wiki

> AI 모션 에셋 생성 SaaS — *Animate anything, your way*

## 🗺️ Map of Content

### 📣 Reports — *먼저 읽는 곳*
- [[05-reports/README|Reports 인덱스]] — 작업/세션/주간/릴리스 보고 모음. 다른 폴더에도 동일 정보가 반영되지만 **여기를 우선해서 읽는다.**

### Product / PM
- [[01-pm/overview|Product Overview]] — 제품 한눈에 보기
- [[01-pm/roadmap|Roadmap]] — 마일스톤과 다음 작업
- 원본 PRD: `../PRD.md` (수정 금지, 위키에서는 링크만)
- [[01-pm/decisions/README|Decisions (ADR)]] — 주요 의사결정 기록
- [[01-pm/meetings/README|Meetings]] — 회의록

### Engineering
- [[02-dev/status|개발 현황 (live)]]
- [[02-dev/architecture|Architecture]]
- [[02-dev/agent-company-blueprint|🤖 에이전트 컴퍼니 설계]]
- [[02-dev/tasks/README|Tasks]]
- Tech Notes
    - [[02-dev/tech-notes/nextjs-16-changes|Next.js 16 변경 영향]]
    - [[02-dev/tech-notes/2026-04-26-evaluator-params-bug|Evaluator PARAMS 매칭 버그]]
    - [[02-dev/tech-notes/2026-04-26-react-resizable-panels-v4-breaking|react-resizable-panels v4 breaking]]

### Research
- [[03-research/README|Research 인덱스]] (시드만 존재, 작성 예정)

### Inbox / Raw
- [[00-inbox/README|Inbox]] — 떠오른 아이디어 던지는 곳
- [[raw/README|Raw sources]] — 외부 자료 원문

### Meta
- [[_meta/taxonomy|Tag taxonomy]]
- [[CLAUDE|Wiki Agent Rules]]
- [[README|이 위키 사용법]]

## 🚀 자주 하는 작업

| 하고 싶은 일 | 어디서 |
|---|---|
| **무슨 일이 있었나 빠르게 보기** | **[[05-reports/README\|Reports]]** |
| 빠르게 메모 던지기 | `00-inbox/` |
| 새로운 결정 기록 | `01-pm/decisions/` (또는 `/adr` 커맨드) |
| 오늘 회의록 | `01-pm/meetings/YYYY-MM-DD-topic.md` |
| 이번 주 진행 상황 보기 | [[02-dev/status]] |
| 트러블슈팅 메모 | `02-dev/tech-notes/` |
| 세션/작업 보고 작성 | `05-reports/YYYY-MM-DD-종류-슬러그.md` |

## 🧩 핵심 컨셉 (3문장 요약)

EasyMake는 텍스트 프롬프트로 Remotion 기반 React 모션 에셋을 생성하고, AI가 자동으로 추출한 파라미터로 **동적 커스터마이징 UI**를 즉시 제공한다.
편집은 코드 레벨에서만 이루어져 비용이 거의 없고, **Export 시에만 Remotion Lambda로 렌더**된다.
경쟁사들이 못 하는 (1) 동적 커스터마이징 UI 자동 생성, (2) React 컴포넌트 export가 핵심 해자다.
