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
- ✅ SOP 갭 보강: `#infra` `#docs` 유형 추가, 혼합 코드+wiki task 처리 명시
- ✅ `/orchestrate` 슬래시 커맨드 + [[orchestrator-runbook|Runbook]] 작성
- ✅ Phase 2 셋업 완료 보고서: [[../05-reports/2026-04-26-phase2-setup-complete|Phase 2 setup complete]]

## 🚀 셋업 완료 — 자율 실행 준비 완료

```bash
# Claude Code 메인 세션에서:
/orchestrate
```

이 한 줄이면 PM → build-team → 회고 → commit → 다음 task 자동 반복.
정지: `touch .agent-state/STOP`. 자세한 내용: [[orchestrator-runbook|Runbook]] 참고.

## 오늘 요약 (2026-04-26)

### 머지된 task
- **TM-11** (PR #2): GEN-06 AI 역질문 (clarifying questions) — 9 파일, 28/28 회귀, verdict APPROVE 92%
- **TM-19** (PR #5): spend.json 자동 갱신 PostToolUse hook — ADR-0006, 3 파일
- **TM-20** (PR #4): /orchestrate 인자 모드 (--once / --max=N / TM-X) — 1 파일
- **TM-21** (PR #3): PM ↔ Task Master 자동 통합 — 2 파일

### 인프라 변경
- **3-tier Orchestrator** 구조 채택 (`prompts/team-lead.md` + `.claude/commands/orchestrate.md` 갱신)
- 3건 병렬 실행 검증 — Orchestrator 컨텍스트 격리 작동 (요약 JSON만 수신)
- spend.json 자동 추적 (ADR-0006)
- PM이 Task Master를 단일 작업 큐 원천으로 통합

### 새 회고 (오늘)
- [[../05-reports/2026-04-26-task-TM-11-retro|TM-11 회고]]
- [[../05-reports/2026-04-26-TM-19-retro|TM-19 회고]]
- [[../05-reports/2026-04-26-TM-20-retro|TM-20 회고]]
- [[../05-reports/2026-04-26-TM-21-retro|TM-21 회고]]

### 백로그 (Task Master)
- done: TM-11, 19, 20, 21 (4건)
- pending: 27건 (TM-3, 5, 12-13, 14-18, 22-35 — TM-26은 의존 해제됨)
- deferred: TM-1/2/9/10 (출시 단계)

## 다음 날 (2026-04-27) iter 3 완료

### 머지된 task (3건 병렬)
- **TM-3** (PR #8): A1 PARAMS 추출 신뢰도 88% pass — 가설 ACCEPT (ADR-0002 검증). 프로덕션 prompt + parser 동시 강화.
- **TM-17** (PR #6): C6 테마 팔레트 일괄 적용 — 6개 팔레트 + 14 신규 테스트 (28→42).
- **TM-26** (PR #7): G1 메타 분석 agent — prompts/meta-analyzer.md + scripts/meta-analysis.sh + launchd plist 2종, 첫 weekly 시드.

### 새 회고
- [[../05-reports/2026-04-26-TM-3-validation|TM-3 Validation]]
- [[../05-reports/2026-04-26-TM-3-retro|TM-3 Retro]]
- [[../05-reports/2026-04-26-TM-17-theme-palette-bulk-apply-retro|TM-17 Retro]]
- [[../05-reports/2026-04-26-TM-26-retro|TM-26 Retro]]
- [[../05-reports/weekly/2026-W17|2026-W17 Weekly Meta]]

### 인사이트 → 신규 task
- TM-36: ADR 번호 충돌 회피
- TM-37: continuous idle ScheduleWakeup 자동화

### 사용자 후속 작업 필요
- `scripts/launchd/README.md` 절차에 따라 `launchctl load` (TM-26 자동 실행)
- 다음 일요일 23:59 첫 자동 호출 검증
- TM-3 후속: maxTokens 상향, exemplar 라벨링, claude-haiku 재현 (P2)

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
