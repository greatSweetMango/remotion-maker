---
title: "Team Retrospective — TM-11 GEN-06 Clarifying Questions"
created: 2026-04-26
updated: 2026-04-26
tags: [report, retrospective]
task_id: TM-11
team_size: 5
team_name: build-tm-11-clarify
duration_minutes: 15
status: completed
verdict: APPROVE
---

# Team Retrospective — TM-11 (GEN-06 AI 역질문)

> **태스크**: 모호한 프롬프트에 AI가 1-3개 객관식 질문 → 답변 후 재생성
> **유형**: `#feature` `#frontend-ui` `#ai-prompt`
> **메타 목표**: 첫 코드 task의 build-team 5명 협업 검증

## 1. 작업 결과

| 항목 | 값 |
|---|---|
| verdict | ✅ APPROVE (92%) |
| 산출물 | 5 (ADR + RS + QA + VL + retro) + 코드 commit (4274c6e) |
| 코드 변경 | 9 파일, +510/-29 (5 src + 1 api + 2 tests + 1 wiring) |
| 테스트 | 19 → 28 (9 신규) |
| TS 에러 | 0 |
| 회귀 | 0건 |
| spec 충족도 | 100% (PRD §5.1 GEN-06) |

## 2. Teammate별 작업 로그

| 역할 | 모델 | 핵심 산출물 | 소요 (대략) |
|---|---|---|---|
| **Researcher** | Sonnet | 흐름 매핑 mermaid + 분기 옵션 3개 비교 + 휴리스틱 후보 + JSON 스키마 초안 + 비용 추정 + 위험 5건 | ~2분 |
| **Architect** | Opus | D1~D8 결정 + RESPONSE MODE DECISION 시스템 프롬프트 블록 + 5 파일 가이드라인 + ADR-0005 | ~3분 |
| **Implementer** | Sonnet | 9 파일 변경 (TDD), 단일 commit, 회귀 무 | ~5분 |
| **QA** | Sonnet | 회귀 28/28, 시나리오 4/4, 비용 측정 정확 | ~2분 |
| **Validator** | Sonnet | 7개 기준 ✅, verdict APPROVE 92%, spot check D1~D8 | ~2분 |

## 3. 피드백 루프 분석

| 항목 | 값 |
|---|---|
| Escalation | 0회 |
| Reviewer ↔ Implementer 루프 | 0 (Reviewer 미사용 — Validator 충분) |
| Loop guard 트리거 | 0 |
| Stall 발생 | 0 |
| Lead nudge 횟수 | 4 (RS→AR, AR→IM, IM→QA, QA→VL) |

## 4. 효율 / 협업 평가 — 매우 양호

### 🟢 잘 작동한 것

- **컨텍스트 파일** (`.agent-state/context-TM-11-clarify.md`) 충실 → 5명 모두 같은 입력 공유
- **산출물 경로 컨벤션** (wiki/CLAUDE.md §8) 준수 → 자연 분리
- **Researcher → Architect 인계** 매끄러움 — Researcher가 정확히 결정 항목 6개를 Architect용으로 정리
- **Architect 결정 명확도** 높음 — D1~D8 + JSON 스키마 + 5 파일 가이드라인 → Implementer가 모호함 0
- **Implementer TDD** 깔끔 — 9 신규 테스트, 회귀 0, 단일 commit
- **단일 LLM 호출 토글** 아키텍처 채택 — 기획 단계 가정(Haiku 추가 호출)보다 더 효율적인 접근 발견

### 🟡 개선 여지

- **Implementer가 Studio.tsx 와이어링까지 추가 변경** — AR-1이 5 파일 가이드 줬지만 실제로는 6개 (Studio.tsx 추가 필요). AR-1 가이드라인이 컴포넌트 props 흐름까지 명시했으면 더 정확
- **PR 응답 shape 변경 영향** — `{asset}` → `{type, asset}`. Implementer가 호출자 검색했으나 외부 API 클라이언트(있다면) 영향 미확인. Architect가 호출자 grep 결과를 가이드라인에 포함하면 더 안전
- **`__skip__` sentinel** — 의도적이지만 구현 트릭. 향후 sentinel 대신 명시적 boolean 필드(`forceGenerate: true`) 권장 검토

### 🔵 SOP 갱신 권장

1. **Architect SOP에 "호출자 영향 grep" 단계 추가** — 함수/API 시그니처 변경 task에서 외부 호출자 grep 결과를 가이드에 포함
2. **`__skip__` 같은 sentinel 패턴 회피 가이드** — 명시적 옵션 필드 권장
3. **컴포넌트 props 흐름** 변경 시 Studio.tsx 같은 wiring 파일도 가이드라인에 명시
4. **PR 응답 shape 변경 위험 체크리스트** — discriminated union 도입 시 외부 호출자 검증 필수

## 5. 메트릭 (정량)

| 메트릭 | 값 |
|---|---|
| 팀 크기 | 5 |
| 총 task | 5 (RS-1, AR-1, IM-1, QA-1, VL-1) |
| 완료 | 5 (100%) |
| 실패 | 0 |
| Escalation | 0 |
| Lead nudge 횟수 | 4 |
| 사용자 어프루벌 | 0 (자동화 정책) |
| 신규 wiki 파일 | 4 (ADR + RS + QA + VL) + 1 (retro) |
| 코드 commit | 1 (4274c6e) |

## 6. 다음 iter에 가져갈 결정

1. **build-team 패턴 검증** — 코드 task에도 5명 팀이 잘 작동. Reviewer 빼고 Validator로 통합한 것 적정.
2. **단일 LLM 호출 토글** 패턴은 향후 다른 분기형 기능 (예: TM-11 답변 → 추가 답변 추적, 또는 새 generate 변형)에 재사용 가능.
3. **API 응답 shape 변경 위험** — 향후 task에서는 PM이 호출자 grep을 사전에 수행 후 build-team 컨텍스트에 포함.
4. **`#frontend-ui` + `#ai-prompt` 이중 태그** 적정 — 단일 태그보다 build-team 라우팅이 정확.

## 7. Phase 1 dry-run에서 발견된 이슈와 비교

이전 (TM-11 이전) Phase 1 dry-run 회고에서:
- 🔴 Idle 자동 wake-up 미작동 → Lead nudge 필요

이번 (TM-11) 회고에서:
- 🟢 Lead nudge가 정상 매개 (4회 발송, 각 phase 전환 매끄러움)
- 🟢 컨텍스트 파일 + 산출물 경로 컨벤션이 효과 발휘
- 🔵 새 발견: Architect 가이드라인에 호출자 grep + wiring 파일 명시 필요

## 8. 관련

- [[../01-pm/decisions/0005-clarify-flow-architecture|ADR-0005]]
- [[../03-research/clarifying-questions-llm-patterns|RS-1 리서치]]
- [[2026-04-26-task-TM-11-qa|QA-1 Report]]
- [[2026-04-26-task-TM-11-validation|VL-1 Validation]]
- 코드: branch `TM-11-gen-06-clarifying-questions` commit `4274c6e`
