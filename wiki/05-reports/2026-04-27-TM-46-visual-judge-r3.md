---
title: TM-46 r3 — Visual LLM-as-judge 30프롬프트 풀런 결과
created: 2026-04-27
updated: 2026-04-27
tags: [qa, llm-judge, r3, visual]
status: active
report_type: session
period: 2026-04-27
author: TeamLead (claude opus 4.7 1M)
---

# TM-46 r3 — Visual LLM-as-judge 풀런 보고

## TL;DR

- 30 프롬프트 × 3 프레임 풀 캡처 + gpt-4o multimodal 채점 완료. **avg=71.2**, acceptance(>=75) **미달**.
- 캡처 28/30 성공 (dv-01·dv-10 generate 500 — `extractJson` 실패, TM-69 영역).
- 카테고리별: loader 85.0 / text-anim 77.5 / infographic 76.7 / transition 63.5 / **data-viz 44.5**.
  data-viz 와 transition 이 평균 끌어내림. 각 카테고리에 단일 강건 케이스(tr-10=90, dv-06=80) 존재.
- 8 judge-flagged + 2 generate-failure → 총 **10 AI-IMPROVE-prompt-* follow-up task** 생성, `triggers_requalify=[46]`.
- 비용: OpenAI ~$0.6 (생성 ~$0.05 + 채점 ~$0.55). 시간 ~50분 (캡처 ~30분 + 채점 ~20분).

## 점수 매트릭스 (28 / 30)

| ID | category | Layout | Typo | Motion | Fidelity | overall | flag |
|---|---|---|---|---|---|---|---|
| dv-02 | data-viz | 2.0 | 2.0 | 1.0 | 1.0 | **15** | ⚠ |
| dv-03 | data-viz | 5.0 | 0.0 | 1.0 | 3.0 | **23** | ⚠ |
| dv-06 | data-viz | 8.0 | 7.0 | 8.0 | 9.0 | 80 | |
| dv-08 | data-viz | 8.0 | 5.0 | 4.0 | 7.0 | **60** | ⚠ |
| ta-01 | text-anim | 7.0 | 8.0 | 4.0 | 8.0 | **68** | ⚠ |
| ta-02 | text-anim | 8.0 | 9.0 | 8.3 | 10.0 | 88 | |
| ta-04 | text-anim | 7.0 | 8.0 | 7.0 | 8.0 | 75 | |
| ta-05 | text-anim | 7.3 | 7.7 | 8.3 | 9.0 | 81 | |
| ta-06 | text-anim | 8.0 | 9.0 | 6.0 | 8.0 | 78 | |
| ta-09 | text-anim | 7.3 | 8.0 | 6.3 | 8.3 | 75 | |
| tr-01 | transition | 8.0 | 7.0 | 8.0 | 8.7 | 79 | |
| tr-02 | transition | 5.0 | 5.0 | 2.0 | 5.0 | **43** | ⚠ |
| tr-03 | transition | 7.0 | 5.0 | 3.0 | 6.0 | **53** | ⚠ |
| tr-05 | transition | 7.3 | 5.0 | 8.0 | 7.0 | **68** | ⚠ |
| tr-08 | transition | 7.0 | 5.0 | 3.0 | 4.0 | **48** | ⚠ |
| tr-10 | transition | 9.0 | 8.0 | 9.0 | 10.0 | 90 | |
| ld-01 | loader | 8.0 | 8.0 | 9.0 | 9.0 | 85 | |
| ld-02 | loader | 8.0 | 9.0 | 8.0 | 9.0 | 85 | |
| ld-03 | loader | 8.0 | 9.0 | 7.7 | 9.0 | 84 | |
| ld-05 | loader | 8.0 | 9.0 | 9.0 | 10.0 | 90 | |
| ld-06 | loader | 8.0 | 7.0 | 9.0 | 9.0 | 83 | |
| ld-09 | loader | 8.0 | 9.0 | 7.3 | 8.7 | 83 | |
| ig-01 | infographic | 8.0 | 9.0 | 7.3 | 9.0 | 83 | |
| ig-02 | infographic | 8.0 | 7.3 | 7.7 | 8.3 | 78 | |
| ig-03 | infographic | 7.0 | 8.0 | 5.0 | 9.0 | 73 | |
| ig-04 | infographic | 7.0 | 8.0 | 7.0 | 8.3 | 76 | |
| ig-06 | infographic | 8.0 | 9.0 | 3.0 | 10.0 | 75 | |
| ig-08 | infographic | 8.0 | 8.0 | 5.0 | 9.0 | 75 | |
| dv-01 | data-viz | — | — | — | — | **N/A** | gen 500 |
| dv-10 | data-viz | — | — | — | — | **N/A** | gen 500 |

## 카테고리 평균

| category | n | avg | min | max |
|---|---|---|---|---|
| data-viz | 4 | **44.5** | 15 | 80 |
| text-anim | 6 | 77.5 | 68 | 88 |
| transition | 6 | **63.5** | 43 | 90 |
| loader | 6 | **85.0** | 83 | 90 |
| infographic | 6 | 76.7 | 73 | 83 |
| **전체** | 28 | **71.2** | 15 | 90 |

## 분석

### 잘 되는 영역
- **loader (85.0)**: 단순 반복 모션 + 명확한 색상 prompt → LLM 이 쉽게 맞춤. 6/6 모두 ≥ 80.
- **text-anim (77.5)**: ta-02 ("Hello World" 타이핑) 88점. 명시적 텍스트 + 단순 modifier 가 강건.
- 단일 강건 reference 가 있다는 건 **루브릭/judge 자체는 calibration 됨**을 시사.

### 약한 영역
- **data-viz (44.5)**: dv-02/dv-03 가 layout 2/5, typography 0/2 수준. 한국어 + 숫자 배열 + 색상 톤
  복합 요청 시 generate 가 빈/플레이스홀더 컴포넌트 출력하는 경향 강함.
- **transition (63.5)**: motion 점수 평균 5.5 — 상태 A→B 가 있어야 하는데 단일 상태 / freeze.
  tr-02 (페이드 검정→흰색) 43점은 색상 보간 자체가 미발생한 의심.
- **infographic motion**: ig-06/ig-08 motion 3/5 — 정적 산출. 시퀀스 entry 부재.

### 캡처 실패
- dv-01 / dv-10 모두 `extractJson` 가 응답에서 JSON 추출 실패 → 500. TM-69
  (json-response-format) 가 머지되면 재시도 가능. 본 회차 결과는 **이 두 케이스 제외**.

## 생성된 follow-up task (10)

자동 spawn 완료. 모두 `dependencies=[46]`, `triggers_requalify=[46]`, priority=medium.

| Task | category | r3 score | 액션 |
|---|---|---|---|
| AI-IMPROVE-prompt-dv-01 | data-viz | gen-fail | TM-69 의존 |
| AI-IMPROVE-prompt-dv-02 | data-viz | 15 | 막대그래프 패턴 + 색상 토큰 강화 |
| AI-IMPROVE-prompt-dv-03 | data-viz | 23 | 비율 정확 분할 + 레이블 |
| AI-IMPROVE-prompt-dv-08 | data-viz | 60 | bar race motion + 가독성 |
| AI-IMPROVE-prompt-dv-10 | data-viz | gen-fail | TM-69 의존 |
| AI-IMPROVE-prompt-ta-01 | text-anim | 68 | 폭발 효과 강화 |
| AI-IMPROVE-prompt-tr-02 | transition | 43 | 색상 보간 구현 |
| AI-IMPROVE-prompt-tr-03 | transition | 53 | zoom + circular reveal 실제 적용 |
| AI-IMPROVE-prompt-tr-05 | transition | 68 | scale full-viewport |
| AI-IMPROVE-prompt-tr-08 | transition | 48 | RGB split / glitch 강화 |

## acceptance 결과

- spec: 평균 ≥ 75 → r4 미발동.
- 실측: **71.2 → 미달**. 차이 -3.8.
- 원인 분리:
  - data-viz/transition 의 generation 품질 문제 (templates / system-prompt 보강 필요).
  - generate JSON 파싱 안정성 (TM-69 가 별도로 진행 중).
- 권고: TM-69 머지 + 위 10개 task 처리 후 r4 재실행. r4 에선 dv-01/dv-10 캡처 가능 → 표본 30/30,
  data-viz 평균 자체가 올라갈 가능성.

## 인프라 / 변경

- 코드 변경 없음 — r2 의 driver/judge/PlayerPanel 그대로 사용.
- artifacts:
  - `__tests__/benchmarks/results/tm-46/screenshots/` (84 PNG, 1280×800)
  - `__tests__/benchmarks/results/tm-46/scores.json` (28 entries)
  - `__tests__/benchmarks/results/tm-46/capture-manifest.json`
- 기록만 추가하는 PR: 본 보고서 + retro.

## 비용 / 시간 (실측)

- generate (28 성공 + 2 실패 재시도 안 함): ~$0.05 OpenAI.
- judge (28 멀티모달, gpt-4o, ~3 image/req): ~$0.55 OpenAI.
- 합계 ~$0.6 (기존 추정 ~$3 의 1/5 — 캐시/이미지 압축 효과로 추정).
- 시간: 캡처 ~30분, 채점 ~20분. 총 ~50분.

## 관련 문서

- 이전: [[2026-04-27-TM-46-visual-judge-r2|r2 보고]]
- 이전: [[2026-04-27-TM-46-retro-r2|r2 회고]]
- 의존: [[2026-04-27-TM-66-judge-migration|TM-66 judge OpenAI 마이그레이션]]
- 코드: `__tests__/benchmarks/tm-46-run-r2.ts`, `__tests__/benchmarks/tm-46-judge.ts`
- 결과: `__tests__/benchmarks/results/tm-46/scores.json`
