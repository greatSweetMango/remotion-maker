---
title: "ADR-0030: Orchestrator v2 — 점진 강화 하드닝"
created: 2026-06-05
updated: 2026-06-05
tags: [decision, area/infra]
status: proposed
provenance: extracted
---

# ADR-0030: Orchestrator v2 — 점진 강화 하드닝

## 컨텍스트

3-tier Ralph 루프(PM → TeamLead → build-team)는 동작하지만, 야간 자율 모드에서 **5대 구조적 약점**이 반복 관측됐다(상세: [[../../05-reports/2026-06-05-orchestrator-v2-research|Orchestrator v2 리서치 합본]]):

1. **TeamLead 단일 long-turn stall / 작업유실** — 진척 체크포인트 부재로 stall 시 통째 유실.
2. **tasks.json 동시쓰기 race + int/str id 혼용** — 병렬 iter writer 충돌, dependency 매칭 깨짐(TM-97 사고).
3. **API키 / dev-server 부재 무처리** — preflight 게이트 부재로 실패를 늦게(혹은 못) 감지.
4. **만성 red CI 무시 머지** — soft 게이트라 회귀 누적.
5. **느슨한 in-flight health 감시** — 실행 중 중단/재배정 신호 약함.

2026-06-05 외부 리서치로 검증된 산업계 패턴 9개 레버를 도출했다(Magentic-One progress ledger, LangGraph checkpoint, OpenAI Swarm guardrails, Hermes tool-calling, evaluator-optimizer self-healing, Temporal/Vercel WDK durable execution, GEPA reflective prompt evolution).

### 대안

- **A. 즉시 durable-engine 전면 도입 (Temporal/Vercel WDK)** — crash-safe·자동 retry로 ①⑤를 근본 해결하나, 인프라 도입 비용·벤더 락인·런타임 재작성 비용이 크고, ①②의 상당 부분은 경량 로컬 구현으로 달성 가능.
- **B. live 자기수정(GEPA) 상시 가동** — SOP/프롬프트를 운영 중 자동 진화. 잠재 이득은 크나, 운영 중 에이전트가 자기 정의를 변형하는 것은 폭주 방지 원칙과 정면 충돌(검증 불가한 자율 self-modify).
- **C. 점진 강화(채택)** — 경량 로컬 패턴(ledger/checkpoint/단일-writer/preflight/hard-CI)을 우선 도입, durable-engine은 보류, GEPA는 오프라인 한정.

## 결정

**Orchestrator v2 — 점진 강화.** 구체적으로:

1. **우선 도입(#1/#2/#5/#6/#8)**:
   - #1 progress-ledger + stall 탐지 (Magentic-One 패턴, TM-205)
   - #2 phase checkpoint/resume (LangGraph 패턴, TM-206)
   - #5 preflight guardrail — 키/dev-server/env 검사 (Swarm 패턴, TM-209)
   - #6 hard CI 게이트 — red 머지 차단 (TM-210)
   - #8 단일-writer + id 정규화(`TM-` 접두 문자열) (TM-212)
2. **durable-engine(Temporal / Vercel WDK) 즉시 도입 보류** — #1/#2가 경량으로 효과를 내므로, 운영 안정화 이후 TM-211에서 재평가.
3. **GEPA는 오프라인 전용 — live self-modify 금지** — 프롬프트/스킬 증류는 오프라인 배치(TM-213/214)로만. 운영 중 에이전트의 자기 프롬프트 변형은 금지.

후속(보강): #3 execute_code tool-calling(TM-207), #4 evaluator-optimizer(TM-208).

## 결과

- 작업유실(①)·데이터 정합성(②)에 직접 닿는 레버를 먼저 처리해 야간 자율 처리량의 실효치 상승 기대.
- preflight(③)·hard CI(④)로 실패를 조기 차단 → 무의미한 long-run 실패와 회귀 누적 감소.
- durable-engine 보류로 인프라 비용/락인 회피, ledger/checkpoint는 경량 로컬 파일로 저비용.
- orchestrator-v2 epic(TM-205~214)의 우선순위·범위를 단일 기준으로 고정.

## 결과적 제약

- 경량 자체 구현(ledger/checkpoint)은 durable-engine만큼의 crash-safe 보장을 주지 못함 — 극단적 장애 시 일부 재실행 필요. TM-211 재평가에서 한계가 드러나면 도입 재고.
- GEPA 오프라인 한정 → 프롬프트 개선 반영 주기가 배치 단위로 느려짐(상시 적응 포기).
- 단일-writer 강제는 병렬성 일부를 직렬화 비용으로 치환.

## 관련

- 리서치: [[../../05-reports/2026-06-05-orchestrator-v2-research|Orchestrator v2 리서치 합본 (TM-204)]]
- 블루프린트: [[../../02-dev/agent-company-blueprint#Orchestrator v2 하드닝(2026-06-05)]]
- 관련 ADR: [[0024-workflow-tooling|ADR-0024 workflow tooling]], [[0025-branch-locks-mutex|ADR-0025 branch-locks mutex]], [[0016-acceptance-gate-v2|ADR-0016 acceptance gate v2]]
- 코드(후속 개정 대상, 본 ADR 미접촉): `.claude/commands/orchestrate.md`, `prompts/team-lead.md`, `.claude/hooks/stop-guard.mjs`, `scripts/orchestrator/`
