---
title: "2026-04-27 — TM-108 r6 품질 벤치마크: TM-117 머지 후 최종 측정 (5/5 완주)"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai/generate, bench, tm-108, tm-117, tm-116, tm-114, tm-112, tm-111]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude Opus 4.7 1M)
---

# TM-108 r6 — Quality benchmark (post TM-117, final, 5/5 completed)

## TL;DR

TM-117 (PR #119 — multi-step EB residue fix: literal `\n` + transpile precheck + named `EvaluatedAsset` + use-client/BOM/NBSP 스트립) 머지 직후, 누적 5개 fix (TM-111 / TM-112 / TM-114 / TM-116 / TM-117) 적용 상태에서 동일 5 케이스를 **baseline + full 둘 다 5/5 완주**.

- **baseline r6**: 5/5 generate-200 + judge 5/5, **avg = 64.2/100** (r1 60.0 → r2 70.6 → r3 71.8 → r4 72.4 → r5 69.8 → **r6 64.2**). 단조 하락 추세 — single-shot LLM 출력 비결정성 + case 4 chart 가 15점으로 크게 끌어내림.
- **full r6 (AI_MULTI_STEP=1)**: 5/5 generate-200 + 5/5 capture + judge 5/5, **avg = 63.6/100** (r4 49.4 → r5 65.0 (n=2) → **r6 63.6 (n=5)**). 처음으로 baseline avg 와 full avg 격차가 사실상 사라짐 (±1점).
- **클린 렌더 r6**: **3/5** (cases 1, 4, 5) — r4 의 2/5 대비 +1, r5 의 0/5* 대비 큰 회복.
- **결론**: 누적 5 fix (TM-111 + 112 + 114 + 116 + 117) 의 합산 효과로 **multi-step 가용성 100% + 클린 렌더 60%** 도달. **목표 5/5 클린은 미달성**이지만 case 2/3 의 `<Unknown>` EB 가 잔존 이슈 핵심으로 좁혀짐. r1 0/5 → r6 3/5 추이는 명확한 개선 곡선.

## r1 → r6 추이 표

| 회차 | 머지 후 | baseline 200/5 | baseline avg | full 200/5 | full avg (judged n) | 클린 렌더 (full) | 비고 |
|---|---|---:|---:|---:|---:|---:|---|
| **r1** | (pre TM-111) | 5/5 | 60.0 | 1/5 | 15.0 (n=1) | 0/5 | multi-step 가용성 80% 붕괴 |
| **r2** | TM-111 sanitize+fallback | 5/5 | 70.6 | 5/5 | 25.2 (n=5) | 0/5 | `Scene1Params is not defined` 100% |
| **r3** | + TM-112 evaluator | 5/5 | 71.8 | 4/5 | n/a | 0/5 | parser 500 1건 + `<Unknown>` EB 100% |
| **r4** | + TM-114 multi-line require | 5/5 | 72.4 | 5/5 | 49.4 (n=5) | 2/5 | 첫 클린 렌더 (chart, typo) |
| **r5** | + TM-116 EB+globals | 5/5 | 69.8 | 4/5* | 65.0 (n=2)* | 0/5* | 부분측정, case 4/5 미완 |
| **r6** | + **TM-117** EB residue | 5/5 | **64.2** | **5/5** | **63.6 (n=5)** | **3/5** | **완주**. baseline/full 격차 -0.6 |

\* r5 의 full 측정은 부분 (case 4/5 미실행). r6 는 **양 모드 모두 5/5 완주** — 추이 비교 신뢰도 확보.

## 케이스별 결과 (r6)

### baseline r6 (`__tests__/benchmarks/results/tm-108/baseline/scores.json`)

| # | id | overall | axes(L/T/M/F) | gen ms | comment |
|---|---|---:|---|---:|---|
| 1 | tm108-1-baseline-simple | **83** | 8/9/7/9 | 5,796 | 심플한 파란 점 디자인 충실 |
| 2 | tm108-2-long-video | **55** | 5/6/4/7 | 6,086 | 단조, 인트로/CTA 흐름 약함 |
| 3 | tm108-3-url-ingest | **80** | 8/7/8/9 | 5,347 | HN 헤드라인 슬라이드 양호 |
| 4 | tm108-4-multi-step-chart | **15** | 2/2/1/1 | 8,314 | single-shot 으로 막대 차트 실패 |
| 5 | tm108-5-multi-step-typo | **88** | 8.5/9/8.5/9 | 6,933 | 키네틱 타이포 매우 우수 |
|   | **avg** | **64.2** | 6.3/6.6/5.7/7.0 | 6,495 |   |

r5(69.8) → r6(64.2): case 4 가 42 → 15 로 다시 큰 폭 하락 — single-shot LLM 비결정성 + 차트 prompt 의 난이도. 다른 4 케이스는 r5 와 ±10 이내.

### full r6 (`__tests__/benchmarks/results/tm-108/full/scores.json`)

| # | id | overall | axes(L/T/M/F) | gen ms | render | 비고 |
|---|---|---:|---|---:|---|---|
| 1 | tm108-1-baseline-simple | **70** | 7/8/5/8 | 15,349 | **clean** | r5 의 500 회귀 해소 (TM-117 효과 확인) |
| 2 | tm108-2-long-video | **50** | 5/5/4/6 | 19,340 | EB `<Unknown>` (4건) | r5 50 과 동일 — 미해소 |
| 3 | tm108-3-url-ingest | **70** | 7/8/6/7 | 15,931 | EB `<Unknown>` (4건) | r5 80 → r6 70 (-10) |
| 4 | tm108-4-multi-step-chart | **50** | 6/5/4/5 | 20,577 | **clean** | r5 EB → r6 clean (회복) |
| 5 | tm108-5-multi-step-typo | **78** | 7.5/8.5/6.5/8.5 | 11,708 | **clean** | r4 점수와 유사 |
|   | **avg** | **63.6** | 6.5/6.9/5.1/6.9 | 16,581 |   |

### Render error breakdown (full r6)

- `<Unknown>` EB **2건** (case 2, 3) — 각각 4건의 콘솔 에러 (mount + 2 frame snapshot × 2). r3/r4/r5 와 동일 패턴 잔존.
- 클린 렌더 **3건** (case 1, 4, 5) — case 1 은 r3 → r5 의 500 / EB 회귀가 r6 에서 해소 (TM-117 의 sanitize 효과). case 4 chart 는 r5 의 Scene2 EB → r6 clean.
- 500 회귀 **0건** — TM-117 의 transpile precheck + literal `\n` 스트립이 효과.
- 평균 generation 시간: 16.6s (r5 의 ~17s 와 동등) — multi-step 비용 증가 없음.

## TM-117 효과 분석

### 긍정 (회귀 해소)

1. **case 1 의 500 회귀 해소**: r5 의 `Unexpected token 1:46` 재발이 r6 에서는 generate 200 + clean render. literal `\n` 디코드 + transpile precheck 가 본 케이스 차단.
2. **case 4 chart 클린 렌더 복귀**: r5 의 `<Scene2>` EB → r6 clean. 결합 효과(TM-116 per-scene boundary + TM-117 EvaluatedAsset displayName + use-client 스트립) 추정.
3. **5/5 완주 + 평균 generation 시간 안정**: 본 r6 는 bench timeout 16분 안에 baseline + full 완주. TM-117 변경이 latency 회귀 없음.

### 부정 (잔존 이슈)

1. **case 2/3 의 `<Unknown>` EB 패턴 미해소**: 두 case 모두 4 EB console log + `<Unknown>` 표시. evaluator 의 default-export 식별 실패 또는 transpile 후 component name 손실로 추정. TM-116 의 `__SceneBoundary` 도입 후에도 boundary 가 잡은 component name 이 `Unknown` — `EvaluatedAsset` displayName 적용은 됐으나 multi-step 의 wrapper 가 별도 path 로 추정.
2. **목표 5/5 미달**: 본 r6 의 3/5 는 r4(2/5) 대비 진보지만 production 승격 기준(5/5)에는 미달. 잔여 2 case 의 EB 가 동일 패턴이라 root cause 1개 해소로 5/5 달성 가능성 높음.

## 후속 / 다음

- [ ] **AI-BUG-multi-step-unknown-eb-long-video-url** fix task — case 2/3 의 `<Unknown>` EB 가 r3 → r6 4회차 잔존. 재현 prompt 2개로 고정 → evaluator/composer 의 wrapper 식별 path 디버깅. `triggers_requalify=[TM-108]`.
- [ ] **multi-step default-off 유지** — r6 의 클린 렌더 60% + 평균 0.6점 격차이지만 case 2/3 의 silent EB (boundary 표시) 가 UX 측면에서 user-visible regression 가능 → production 승격 보류.
- [ ] **baseline noise mitigation** — r1~r6 의 baseline avg 변동 (60.0 ↔ 72.4 ↔ 64.2) 이 single-shot LLM 비결정성 + 1회 측정 한계. 차회 r7 (있을 시) 은 case 당 3회 측정 + median 채택 검토.
- [ ] **ADR 후보 — multi-step 안정성 5/5 도달 시 production 승격**: 현재 정량 근거 (가용성 100%, 클린 60%, 평균 격차 -0.6) 를 ADR placeholder 로 박제하고, AI-BUG fix 머지 후 r7 에서 5/5 달성 시 production-on 권고.

## 출처 / 링크

- 이전 회차: [[2026-04-27-TM-108-quality-benchmark|r1]] · [[2026-04-27-TM-108-quality-benchmark-r2|r2]] · [[2026-04-27-TM-108-quality-benchmark-r3|r3]] · [[2026-04-27-TM-108-quality-benchmark-r4|r4]] · [[2026-04-27-TM-108-quality-benchmark-r5|r5]]
- 직전 fix: [[2026-04-27-TM-117-fix|TM-117 multi-step EB residue]]
- 누적 fix 체인: TM-111 (sanitize) → TM-112 (Scene{N}Params) → TM-114 (multi-line require) → TM-116 (28 globals + SceneBoundary) → **TM-117** (literal \n + EvaluatedAsset)
- 코드: `../../src/lib/remotion/evaluator.ts`, `../../src/lib/ai/pipeline.ts`
- 벤치 드라이버: `../../__tests__/benchmarks/tm-108-bench.ts`
- 결과(JSON+PNG): `../../__tests__/benchmarks/results/tm-108/baseline/`, `../../__tests__/benchmarks/results/tm-108/full/`
- stdout 캡처: `/tmp/tm-108-r6-baseline.out`, `/tmp/tm-108-r6-full.out`
- dev 서버 로그: `/tmp/tm-108-r6-dev.log`, `/tmp/tm-108-r6-dev-full.log`
