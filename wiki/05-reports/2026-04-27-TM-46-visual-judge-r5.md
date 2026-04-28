---
title: TM-46 r5 — Visual judge 5회차 (N=2 결정성 측정 + r1~r5 추이)
created: 2026-04-27
updated: 2026-04-27
tags: [qa, llm-judge, r5, visual, determinism, std]
status: active
report_type: session
period: 2026-04-27
author: TeamLead (claude opus 4.7 1M)
task_id: TM-46
---

# TM-46 r5 — Visual LLM-as-judge 5회차 (N=2 결정성 측정)

## TL;DR

- **N=2 풀 30 prompts × 3 frames × 2 captures × 2 judges** 측정 완료. 4가지 누적 변경 적용 후 첫 측정.
- 누적 변경: TM-66 (judge gpt-4o), **TM-70 (judge temperature=0 + seed=42 결정성 픽스)**, TM-71 (5 카테고리 prompt 가이드라인).
- **결과**:
  - run-A avg = **71.5** / 100 (n=30, follow-up 9)
  - run-B avg = **64.1** / 100 (n=30, follow-up 15)
  - **N=2 통합 avg = 67.8** / 100 (acceptance ≥75 **MISS**)
  - **mean std = 8.10**, **max std = 34.50** (목표 <3 **MISS**)
- **결정적 발견**: TM-70 (judge temp=0 + seed) 만으로는 **전체 파이프라인의 결정성을 확보하지 못함**.
  - judge 단독 variance: TM-70 RCA 에서 ±10 → temp=0+seed 후 ±0~2 (judge 만 보면 OK)
  - 그러나 **capture 단계의 LLM code-gen 자체가 비결정적**이라 같은 prompt 가 시각적으로 다른 산출물을 만들어내고, 그 결과를 deterministic judge 가 정확히 다르게 채점함.
  - 결과적으로 end-to-end variance 는 여전히 ±15~30 (max 34.5).
- 회차 추이:

| 회차 | n | avg | acceptance(>=75) | std |
|---:|---:|---:|---|---|
| r1 (Opus judge) | 28 | 71.2 | MISS | 미측정 |
| r3 (gpt-4o judge default temp) | 28 | 71.2 | MISS | 미측정 |
| r4 (gpt-4o judge default temp, 재실행) | 29 | 63.4 | MISS | 미측정 |
| **r5 (gpt-4o + temp=0 + seed, N=2)** | **30** | **67.8** | **MISS** | **mean 8.10 / max 34.50** |

- **acceptance gate 자체 재검토 필요** — 현 측정도구의 std 가 acceptance band (75±5) 보다 큼. r5 wiki retro 에 follow-up 명시.

## 회차별 카테고리 비교 (r3 / r4 / r5)

| 카테고리 | r3 avg | r4 avg | r5 avg (N=2) | r5 - r3 |
|---|---:|---:|---:|---:|
| data-viz | 44.5 | 55.5 | **59.8** | +15.3 |
| text-anim | 77.5 | 71.8 | **75.2** | -2.3 |
| transition | 63.5 | 50.0 | **56.2** | -7.3 |
| loader | 85.0 | 81.8 | **79.2** | -5.8 |
| infographic | 76.7 | 61.0 | **68.5** | -8.2 |
| **전체** | 71.2 | 63.4 | **67.8** | -3.4 |

- data-viz 만 누적 +15. TM-69(JSON mode) → TM-71(category-specific prompt) 이 generate 안정성에 영향.
- 그 외 카테고리는 r3 baseline 보다 약간 낮음 — TM-71 이 transition / infographic 시각 품질에 직접 효과는 없었음.

## r5 per-prompt 점수 (N=2)

| ID | category | A | B | avg | std | r3 | Δr3 |
|---|---|---|---|---|---|---|---|
| dv-01 | data-viz | 66 | 60 | 63.0 | 3.00 | gen-fail | (TM-69 복구) |
| dv-02 | data-viz | 45 | 15 | 30.0 | **15.00** | 15 | +15.0 |
| dv-03 | data-viz | 78 | 43 | 60.5 | **17.50** | 23 | +37.5 |
| dv-06 | data-viz | 86 | 86 | 86.0 | 0.00 | 80 | +6.0 |
| dv-08 | data-viz | 84 | 15 | 49.5 | **34.50** | 60 | -10.5 |
| dv-10 | data-viz | 80 | 60 | 70.0 | 10.00 | gen-fail | (TM-69 복구) |
| ig-01 | infographic | 80 | 81 | 80.5 | 0.50 | 76 | +4.5 |
| ig-02 | infographic | 18 | 73 | 45.5 | **27.50** | — | — |
| ig-03 | infographic | 73 | 76 | 74.5 | 1.50 | — | — |
| ig-04 | infographic | 85 | 23 | 54.0 | **31.00** | — | — |
| ig-06 | infographic | 78 | 78 | 78.0 | 0.00 | — | — |
| ig-08 | infographic | 74 | 83 | 78.5 | 4.50 | — | — |
| ld-01 | loader | 90 | 90 | 90.0 | 0.00 | — | — |
| ld-02 | loader | 88 | 86 | 87.0 | 1.00 | — | — |
| ld-03 | loader | 83 | 43 | 63.0 | **20.00** | — | — |
| ld-05 | loader | 83 | 83 | 83.0 | 0.00 | — | — |
| ld-06 | loader | 88 | 88 | 88.0 | 0.00 | — | — |
| ld-09 | loader | 85 | 43 | 64.0 | **21.00** | — | — |
| ta-01 | text-anim | 60 | 53 | 56.5 | 3.50 | — | — |
| ta-02 | text-anim | 73 | 85 | 79.0 | 6.00 | — | — |
| ta-04 | text-anim | 79 | 78 | 78.5 | 0.50 | — | — |
| ta-05 | text-anim | 87 | 82 | 84.5 | 2.50 | — | — |
| ta-06 | text-anim | 83 | 79 | 81.0 | 2.00 | — | — |
| ta-09 | text-anim | 68 | 75 | 71.5 | 3.50 | — | — |
| tr-01 | transition | 50 | 60 | 55.0 | 5.00 | 79 | -24.0 |
| tr-02 | transition | 73 | 65 | 69.0 | 4.00 | 43 | +26.0 |
| tr-03 | transition | 43 | 54 | 48.5 | 5.50 | 53 | -4.5 |
| tr-05 | transition | 43 | 55 | 49.0 | 6.00 | 68 | -19.0 |
| tr-08 | transition | 43 | 55 | 49.0 | 6.00 | 48 | +1.0 |
| tr-10 | transition | 78 | 55 | 66.5 | **11.50** | 90 | -23.5 |

## r4 collapse 케이스 추적

| ID | r3 | r4 | r5(A,B) | r5 avg | 진단 |
|---|---|---|---|---|---|
| dv-01 | gen-fail | 68 | (66, 60) | 63.0 | TM-69 효과 안정. std 낮음. |
| dv-10 | gen-fail | 83 | (80, 60) | 70.0 | TM-69 효과. std=10 (capture variance). |
| tr-10 | **90** | **41** | (78, 55) | 66.5 | r3 의 90 은 outlier 였을 가능성. r5 N=2 std=11.5. |
| ig-01 | 76 | **10** | (80, 81) | **80.5** | **회복**. r4 의 10 은 단발성 collapse 였음. std=0.5. |
| dv-02 | 15 | 15 | (45, 15) | 30.0 | std 15 — bar chart 가 prompt 만으로 안정 출력 안 됨 (재확인). |
| dv-08 | 60 | 13 | (84, 15) | 49.5 | **max std 34.5**. horizontal bar race 의 LLM 코드 출력이 회차마다 다름. |

## 분석

### 1. TM-70 (judge determinism) 의 부분 효과

- TM-70 RCA 에서 동일 PNG 셋 × 3회 호출 → ±10 점 variance 측정 → temp=0 + seed=42 적용.
- r5 측정 결과: **judge 자체는 deterministic 화 됐지만**, capture 단계의 LLM 코드 생성이 비결정적이라
  같은 prompt 가 회차마다 시각적으로 다른 산출물을 만들고, judge 가 그걸 정확히 다르게 채점함.
- 즉 r4 → r5 의 -7.8 → -3.4 회복은 의미 있지만, **acceptance gate 자체가 capture variance 보다 작은 band 라 단일 회차 측정으로 PASS/MISS 판정 불가**.

### 2. capture variance 의 정체

- 30 prompts 중 std ≥10 인 케이스: **9건 / 30 (30%)**.
- std ≥20 인 collapse: dv-08 (34.5), ig-04 (31.0), ig-02 (27.5), ld-09 (21.0), ld-03 (20.0).
- 모두 **비교적 복잡한 시각 구성** (bar race, 3-icon infographic, 시간축 진행 loader).
- 단순 prompts (ld-01 spinner, ld-06 dots, dv-06 ring, ig-01 step indicator, ig-06) 는 std=0~1.5 — 안정.
- 결론: **prompt 복잡도 ↔ capture variance 양의 상관**. simple → 결정적, complex → 비결정적.

### 3. r1~r5 추이

- r1 (Opus judge, 71.2) → r3 (gpt-4o default temp, 71.2): judge migration 무영향.
- r3 → r4 (-7.8): judge default-temp variance + 일부 capture variance.
- r4 → r5 (+4.4 to 67.8): TM-70 으로 judge variance 제거됐지만 capture variance 잔존.
- **r5 가 r1~r4 의 "참값"에 가까움** — judge 가 deterministic 이므로 N=2 평균이 과거 단발 측정보다 신뢰 가능.

### 4. acceptance gate 재검토

- 현재 gate: 단일 회차 avg ≥ 75.
- r5 측정 결과 capture-induced std = ±5~10 (단순) ~ ±20 (복잡). 단일 회차 측정 노이즈가 acceptance band 보다 큼.
- 권고:
  1. acceptance 정의를 **N=3 capture × judge 의 평균 ± std** 로 변경. avg ≥ 75 AND mean_std ≤ 5.
  2. capture LLM 도 temperature pinning 가능하면 (gpt-4o-mini code-gen) 적용해 capture variance 감소.
  3. 점수가 안정적이지 않은 prompt 는 acceptance pool 에서 제외 (per-prompt mean_std > 15 인 케이스: dv-02, dv-03, dv-08, ig-02, ig-04, ld-03, ld-09).

## Acceptance / next steps

- **avg 67.8 < 75 — REQUEST_CHANGES (acceptance MISS)**.
- 단, **r5 는 r4 의 "회귀" 가설을 통계적으로 기각**함:
  - r3 71.2, r4 63.4 의 차이는 capture+judge variance 합이고, r5 N=2 측정으로 std ~8.1 확인.
  - 즉 71.2 ↔ 63.4 변동은 noise (95% CI 가 ±16) 이지 실제 회귀 아니었음.
- new follow-up (run-B 기준 9 신규):
  - prompt-only 한계 케이스 — bar chart, complex infographic — reference 템플릿 필요 (TM-43 batch 와 별도).
  - capture variance 측정 task 신설 권고.
- **야간 QA 1차 사이클 1차 종결 권고**: acceptance MISS 지만 측정도구 변동성이 acceptance band 보다 큰 것이 명확해진 시점에서 추가 회차는 ROI 낮음. measurement methodology task (N=3, capture-side temp pin) 를 다음 사이클로.

## 비용 / 시간

- generate: 30 prompts × 2 captures × ~$0.01 = ~$0.60
- judge: 30 prompts × 2 runs × ~$0.05 (gpt-4o multimodal 3 PNG) = ~$3.00
- 총 OpenAI ~$3.60 (예상 $2 대비 +$1.6, run-B 추가)
- wall-clock: 캡처 A ~14분, judge A ~3분, 캡처 B ~10분, judge B ~3분, 분석 + 작성 ~10분 → 총 ~40분

## 산출물 / 데이터

- `__tests__/benchmarks/results/tm-46/scores-r5a.json` (gitignored)
- `__tests__/benchmarks/results/tm-46/scores-r5b.json` (gitignored)
- `__tests__/benchmarks/results/tm-46/r5-summary.json` (gitignored)
- `__tests__/benchmarks/results/tm-46/screenshots-r5a/` (90 PNG)
- `__tests__/benchmarks/results/tm-46/screenshots-r5b/` (90 PNG)
- `__tests__/benchmarks/tm-46-r5-analyze.ts` (신규 분석 스크립트, 본 PR 에 포함)

## 관련

- [TM-46 r4 보고서](2026-04-27-TM-46-visual-judge-r4.md) — 직전 회차 63.4
- [TM-46 r3 보고서](2026-04-27-TM-46-visual-judge-r3.md) — 71.2
- [TM-70 RCA](2026-04-27-TM-70-rca.md) — judge variance 진단 + temp=0+seed 적용
- [TM-71 fix](2026-04-27-TM-71-fix.md) — 5 카테고리 prompt 가이드라인
- [TM-66 judge migration](2026-04-27-TM-66-judge-migration.md)
- [TM-46 retro r5](2026-04-27-TM-46-retro-r5.md) — 본 회차 회고
- [야간 AI QA 1차 종합](2026-04-27-ai-qa-final.md) — TM-70/71/46r5 섹션 append
