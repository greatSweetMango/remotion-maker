---
title: 개발 현황 (Live)
created: 2026-04-26
updated: 2026-04-26
tags: [dev, status/active]
status: active
---

# 🛠️ 개발 현황

> 최근 빌드 보고서 원본: `../../docs/REPORT.md`
> `/weekly-status` 커맨드로 자동 갱신 가능

## 현재 상태 (2026-04-26 기준)

- **빌드:** ✅ Next.js 16.2.4 / 16 routes
- **테스트:** ✅ 19/19 pass (3 suites)
- **TS 에러:** 0
- **마지막 메이저 변경:** 2026-04-26 — 에이전트 컴퍼니 Phase 1 dry-run 성공, Phase 2 진입
- **에이전트 컴퍼니 단계:** **Phase 2 진입** (PM agent + Task Master SoT 정착)

## 에이전트 컴퍼니 진행

### Phase 1 완료 (dry-run 성공) — 2026-04-26
- 첫 build-team 실행: `phase1-001` blueprint mermaid 변환
- 4 teammate (Researcher, Architect, Implementer, Validator) 정상 작동
- 회고 자동 wiki 저장: [[../05-reports/2026-04-26-task-phase1-001-retro|retro]]
- 산출물 4건 + 코드 변경 1건, escalation 0회, verdict APPROVE
- Wiki 소유권 옵션 2 (main 단독) 첫 적용 성공
- 자동화 우선 정책 검증 (사용자 개입 0건)

### Phase 2 진입 — 2026-04-26
- ✅ Task Master 환경 확인 (`claude-code` provider, 10 task 기등록)
- ✅ Ralph 프롬프트 v1 박제 (Phase 전환 자동 nudge + shutdown 시퀀스)
- ✅ 산출물 경로 컨벤션 wiki/CLAUDE.md §8에 박제
- ✅ PM agent 호출 검증 통과 (TM-1 fetch + 라우팅 결정 정상)
- 🔜 다음 build-team 실행: PM agent가 자율 디스패치하는 첫 task

## 최근 세션 (2026-04-25 ~ 2026-04-26)

### Studio 통합 & UX 개선
- ✅ **TemplatePicker 중앙 패널 통합** — asset 없을 때 템플릿 갤러리, 헤더에 "Templates" 복귀 버튼
- ✅ **`useStudio` 훅 확장** — `initTemplate()`, `clearAsset()` + `CLEAR_ASSET` reducer 추가
- ✅ **템플릿 썸네일 검은화면 버그 수정** — `evaluator.ts`의 `buildReturnStatement()`가 `PARAMS`(SCREAMING_CASE)를 컴포넌트 이름보다 먼저 매칭하던 버그를 PascalCase 필터로 해결
- ✅ **TemplatePicker 격리** — `autoPlay`, `initialFrame={45%}`, `pointerEvents:none`

### 레이아웃 / CSS
- ✅ **우측 패널 잘림 수정** — `react-resizable-panels` v4 breaking change: 숫자값=px, 문자열=%. 모든 `defaultSize`를 문자열로 변경
- ✅ **Studio overflow 가드** — `globals.css`에 `[data-panel]`, `[data-panel-group]` 셀렉터 추가

### Auth (Next.js 16 호환)
- ✅ **Dev 자동 로그인 수정** — `signIn()`을 Server Component에서 직접 호출 시 쿠키 에러 발생 → Server Action 패턴으로 분리 (`AutoLoginForm.tsx` + `actions.ts`)
- ✅ **Dev 유저 Pro 플랜 보장** — 생성/업데이트 시 `tier: 'PRO'` 자동 설정

### 인프라 / DX
- ✅ **Obsidian MCP 위키 연동** — `iansinnott/obsidian-claude-code-mcp` 플러그인 설치, `.mcp.json` SSE 설정 (포트 22360)

## 진행 중 (In progress)

- [ ] 환경변수 실제 키 주입
- [ ] Vercel 배포 준비
- [ ] 커스터마이징 파라미터 추출 신뢰도 검증 (A1)

## 다음 (Up next)

- [ ] Remotion Lambda 프로덕션 셋업
- [ ] 추가 템플릿 제작 (목표 10~20개)
- [ ] SEO 랜딩 페이지 추가

## 막힘/리스크

- 없음 (현 시점)

## 핵심 메트릭 추적 (계획)

PRD §10 — 런칭 후 3개월 KPI:
- 가입자 1,000명
- Free→Pro 전환 5%
- 월 5,000회 생성

## 관련

- [[../01-pm/roadmap]]
- [[architecture]]
- [[../01-pm/decisions/README|ADR 인덱스]]

## Dataview: 최근 변경된 페이지

```dataview
TABLE updated, tags
FROM ""
WHERE updated
SORT updated DESC
LIMIT 10
```
