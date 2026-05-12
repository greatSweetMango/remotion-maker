---
title: "2026-05-13 — TM-85 Pipeline Quality Acceptance Benchmark"
created: 2026-05-13
updated: 2026-05-13
tags: [report, qa, ai, generate, edit]
status: active
report_type: session
period: "2026-05-13 (15:08–15:30 UTC)"
author: TeamLead/TM-85
---

# TM-85 — Pipeline Quality Acceptance Benchmark (30 prompts)

## TL;DR

30개 다양한 prompt corpus 로 generate→(clarify→answer)→edit×3 풀 사이클을 실측. **mode_match 25/30 (83.3%)** 로 90% 게이트 미달 → `REQUEST_CHANGES`. 나머지 4 acceptance(skeleton 0, params_lost 0, unintended 2.2%, edit 90/90 성공)는 전부 PASS. **단일 회귀 근원**: 데이터-비주얼 prompt 5건이 전부 clarify-first 로 빠지는 over-trigger.

## 결과 요약

| 지표 | 값 | 게이트 | 판정 |
|---|---|---|---|
| 총 prompt | 30 | — | — |
| mode_match | 25 / 30 (83.3%) | ≥ 90% | FAIL |
| Skeleton-echo hits | 0 | 0 | PASS |
| Edits attempted | 90 (30 × 3) | — | — |
| Edits OK | 90 / 90 (100%) | — | PASS |
| PARAMS lost | 0 | 0 | PASS |
| Unintended changes | 2 / 90 (2.2%) | ≤ 10% | PASS |
| **Verdict** | — | — | **REQUEST_CHANGES** |

### 카테고리별 정확도

| 카테고리 | n | mode_match | pct |
|---|---|---|---|
| character (clarify expected) | 10 | 10 | **100%** |
| motion-graphics (generate) | 10 | 10 | **100%** |
| data-viz (generate) | 5 | **0** | **0%** ⚠ |
| typography (generate) | 5 | 5 | **100%** |

### Latency (ms)

| stage | n | avg | p50 | p95 |
|---|---|---|---|---|
| generate (all) | 30 | 11318 | 10786 | 25125 |
| edit (all) | 90 | 7067 | 6676 | 11392 |

카테고리별 generate 평균: character 6882, motion-graphics 13356, data-viz 10149, typography 17285.

## 발견된 회귀 — Data-viz over-clarify

5건 모두 mode=clarify 로 분기. 첫 choice 로 응답 후 두 번째 generate 는 정상 완료(asset 생성·edit 3/3 성공) → **사용자가 클라리파이 UI 한 단계를 더 거쳐야 함** = UX 회귀.

| id | prompt | 1차 mode | 질문 수 | 2차 OK |
|---|---|---|---|---|
| D01 | "Bar chart top 5 products by revenue" | clarify | 1 | YES |
| D02 | "막대 그래프 매출 상위 10" | clarify | 1 | YES |
| D03 | "Pie chart device breakdown 4 segments" | clarify | 4 | YES |
| D04 | "Line chart stock price daily" | clarify | 1 | YES |
| D05 | "Donut chart user signups" | clarify | 4 | YES |

### RCA — `clarify-gate.scoreConcreteness` 시뮬레이션

| prompt | hits | score | hasVisualDomain | isConcrete | forceSkipClarify |
|---|---|---|---|---|---|
| D01 | subject+data | 2 | true | **true** | false |
| D02 | subject+data (+KO+1) | 3 | true | **true** | false |
| D03 | subject | 1 | true | false | false |
| D04 | subject+data | 2 | true | **true** | false |
| D05 | subject | 1 | true | false | false |

- D01/D02/D04 는 gate 가 `isConcrete=true` 판정 → force-generate retry 가 실행됨에도 LLM 이 **다시 clarify 반환** → fallback 으로 그냥 clarify 가 사용자에게 surface. (forceSkipClarify 가 false 이므로 hardened-retry 가 발동되지 않음.)
- D03/D05 는 score=1 로 gate threshold(=2) 미달 → force-generate 자체가 발동 안 됨.

핵심 누락:
1. `COUNT_PATTERNS` 가 "4 segments", "10 items" 같은 plural noun count 를 일부만 인식. "segments" 는 패턴에 포함되지 않음 → D03 score=1.
2. `DATA_PATTERNS` 가 "signups" / "device" / "breakdown" / "daily" 같은 흔한 비즈 dashboard 어휘를 누락 → D05 score=1.
3. forced retry 가 1회로 끝나고 forceSkipClarify 조건이 좁아(entity_count≥2 또는 hits≥3) data-viz 카테고리를 못 받침 → D01/D02/D04 가 fallback clarify 로 빠짐.

## 권고 — 후속 fix

`clarify-gate.ts` 보강 (TM-NEXT-A 로 spawn):

1. `COUNT_PATTERNS` 에 `segments?|slices?|categories?|series` 등 data-viz 단위 추가.
2. `DATA_PATTERNS` 에 `signups?|breakdown|daily|monthly|weekly|device|category|product` 등 dashboard 어휘 보강.
3. data-viz 분기 reinforcement (chart 종류 prompt 가 force-generate 1차에 또 clarify 면 hardened retry 발동) — `forceSkipClarify` 조건에 `hits.includes('subject') && hits.includes('data')` OR `chart-style subject` 추가.
4. 재검증: TM-85 corpus 5건이 generate-first 로 통과해야 한다.

## 무엇이 통과했나 — 기존 fix(TM-83/TM-127)는 회귀 없음

- character 10/10 모두 clarify (visual-domain gate 유지 ok).
- motion-graphics 10/10 즉시 generate (TM-52/68 entity-count + concreteness gate ok).
- typography 5/5 즉시 generate (quote+style hits).
- **Skeleton echo 0건** — PR #127 detector 회귀 없음.
- **PARAMS 보존 100%** (90 edits, 0 손실).
- 의도 외 변경 2건만 (C02 dogColor / M05 cursorColor) — 둘 다 "primaryColor 변경" 의도와 의미론적으로 부합하는 동질 색상 키. UX 측면 acceptable.

## 영향

- **사용자**: data-viz prompt 사용자는 한 단계 클라리파이를 더 거침. 기능 차단은 아니나 UX 회귀.
- **비용**: clarify→answer→generate 2-round LLM 호출 → 평균 +1 OpenAI call/prompt. corpus 5건 기준 미미.
- **테스트**: 본 driver(`scripts/qa/tm-85-pipeline-quality.mjs`)는 향후 야간 품질 베이스라인으로 재사용.

## 후속

- [ ] **TM-NEXT-A** spawn — `clarify-gate.ts` data-viz 어휘·forceSkipClarify 보강 (triggers_requalify: TM-85).
- [ ] fix 머지 후 TM-85 re-run (회차 r2) — 30/30 mode_match 목표.

## 출처 / 링크

- Driver: `../scripts/qa/tm-85-pipeline-quality.mjs`
- Raw results: `screenshots/TM-85/results.json`
- Summary: `screenshots/TM-85/summary.json`
- 관련 코드: `../src/lib/ai/clarify-gate.ts`, `../src/lib/ai/generate.ts:415-487`
- 전 회차 baseline: [[2026-05-12-TM-83-clarify-regression]]
- 관련 ADR: [[../01-pm/decisions/ADR-PENDING-TM-82-character-scene-rendering|character/scene 렌더링 캐퍼빌리티]]
