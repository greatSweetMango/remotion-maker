---
title: "2026-04-27 — TM-108 r5 품질 벤치마크: TM-116 EB fix 후 최종 측정 (부분)"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai/generate, bench, tm-108, tm-116, tm-114]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude Opus 4.7 1M)
---

# TM-108 r5 — Quality benchmark (post TM-116, partial)

## TL;DR

TM-116 (evaluator 28 globals destructure + `__SceneBoundary` per-scene + displayName, PR #117) 머지 직후 동일 5 케이스 r5 최종 측정을 시도. **목표: 클린 렌더 5/5**.

- **baseline r5**: 5/5 generate-200 + judge 5/5, **avg=69.8/100** (r1 60.0 → r2 70.6 → r3 71.8 → r4 72.4 → r5 **69.8**). 첫 하락이지만 `case 1=90`, `case 5=88` 등 단순 케이스 유지.
- **full r5 (AI_MULTI_STEP=1)**: **부분 측정** — 4/5 generate 시도 중 **case 1 가 500 회귀(`SyntaxError 1:46`)**, case 2/3 가 capture 되었으나 모두 `<Unknown>` ErrorBoundary, case 4 chart 가 `<Scene2>` EB + bench 인터럽트로 미완(case 5 미실행).
- **클린 렌더 r5**: **0/5 (가용성 측정 가능한 4건 중)** — TM-116 의 `__SceneBoundary` 도입은 EB 가시화/안정성에 기여했지만, multi-step 코드 자체의 깨짐(case 1 의 `Unexpected token 1:46`, case 2/3 의 evaluator default-export 실패) 은 미해소.
- **결론**: TM-116 머지에도 **multi-step 가용성/렌더 품질은 r4 대비 회귀**. r4 의 5/5 가용성 + 클린 2/5 → r5 의 부분 capture 시 4/5 가용성 + 클린 0/5. 단, 본 r5 측정은 **case 4/5 미완**으로 추이 비교 신뢰도 낮음 — 재실행 필요.

## r1 → r4 → r5 추이 표

| 회차 | 머지 후 | baseline 200/5 | baseline avg | full 200/5 | full avg (judged n) | 클린 렌더 (full) | 비고 |
|---|---|---:|---:|---:|---:|---:|---|
| **r1** | (pre TM-111) | 5/5 | 60.0 | 1/5 | 15.0 (n=1) | 0/5 | multi-step 가용성 80% 붕괴 |
| **r2** | TM-111 sanitize+fallback | 5/5 | 70.6 | 5/5 | 25.2 (n=5) | 0/5 | `Scene1Params is not defined` 100% |
| **r3** | + TM-112 evaluator | 5/5 | 71.8 | 4/5 | n/a | 0/5 | parser 500 1건 + `<Unknown>` EB 100% |
| **r4** | + TM-114 multi-line require | 5/5 | 72.4 | 5/5 | 49.4 (n=5) | **2/5** | 첫 클린 렌더 (chart, typo) |
| **r5** | + **TM-116** EB+globals | 5/5 | **69.8** | **4/5*** | **65.0 (n=2)** | **0/5*** | * 부분 측정, case 4/5 미완 |

\* r5 full 은 case 1(500 회귀) + case 2/3(captured, both EB) + case 4(중간 EB, bench 인터럽트) + case 5(미실행) — n=2 judge 만 완료. 클린 렌더는 capture 된 2 건 모두 `<Unknown>` EB 라 0/2 확정, 나머지는 미측정.

## 케이스별 결과 (r5)

### baseline r5 (`__tests__/benchmarks/results/tm-108/baseline/scores.json`)

| # | id | overall | axes(L/T/M/F) | comment |
|---|---|---:|---|---|
| 1 | tm108-1-baseline-simple | **90** | 8/9/9/10 | 깔끔한 디자인, 프롬프트 충실 |
| 2 | tm108-2-long-video | **45** | 5/6/3/4 | 단조, 핵심 가치 누락 |
| 3 | tm108-3-url-ingest | **74** | 7/8/6.5/8 | HN 스타일 일부 반영 |
| 4 | tm108-4-multi-step-chart | **42** | 5/6/2.5/3 | 막대 표현 약함 |
| 5 | tm108-5-multi-step-typo | **98** | 10/10/9/10 | 키네틱 타이포 매우 양호 |
|   | **avg** | **69.8** | 7.0/7.8/6.0/7.0 |   |

r4(72.4) → r5(69.8): **case 4 가 65→42 로 크게 하락**(통제군임에도 single-shot 결과가 변동). 측정 noise 가능성 + LLM 비결정성. 다른 4 케이스는 안정.

### full r5 (`__tests__/benchmarks/results/tm-108/full/scores.json`)

| # | id | gen ms | dur(f) | render | overall | axes(L/T/M/F) | 비고 |
|---|---|---:|---:|---|---:|---|---|
| 1 | tm108-1-baseline-simple | — | — | **500 회귀** | n/a | — | `Unexpected token, expected "(" (1:46)` — r3 와 동일 패턴 재발 |
| 2 | tm108-2-long-video | 19,421 | 1800 | EB `<Unknown>` | **50** | 5/5/4/6 | EB 콘솔 4건. 점수는 r4(43) 보다 약간 상승 |
| 3 | tm108-3-url-ingest | 15,605 | 150 | EB `<Unknown>` | **80** | 8/9/7/8 | r4(13) 대비 큰 폭 상승 — `__SceneBoundary` 가 부분 컴포넌트 렌더 허용 |
| 4 | tm108-4-multi-step-chart | 30,272 | 300 | EB `<Scene2>` (partial) | n/a | — | chart 생성 30s 소요. Scene2 EB 후 bench 인터럽트 |
| 5 | tm108-5-multi-step-typo | — | — | 미실행 | n/a | — | bench 가 case 4 에서 타임아웃/인터럽트 |

### Render error breakdown (full r5, measured)

- `<Unknown>` EB 2건 (case 2, 3) — r3 와 동일 패턴 잔존 (evaluator default-export 실패).
- `<Scene2>` EB 1건 (case 4) — TM-116 의 per-scene `__SceneBoundary` 덕에 Scene1 은 렌더되고 Scene2 만 격리됨 (개선 신호).
- 500 1건 (case 1) — r3 의 `SyntaxError 1:46` 패턴이 TM-114 머지 후에도 다시 등장. TM-114 의 sanitize 가 case 1 특정 형태(짧은 spinner) 에서는 매번 잡지 못함 → **간헐 회귀**.
- case 5 미측정.

## TM-116 효과 분석 (부분)

### 긍정
- **per-scene EB 격리 효과 관찰**: case 4 에서 `<Scene2>` 만 EB 표시 — r4 의 통합 `<Unknown>` EB 와 달리 어느 scene 이 깨졌는지 가시화. multi-step debugging 능력 향상.
- **부분 렌더 점수 회복**: case 3 (url-ingest) 가 r4 13 → r5 80 — `__SceneBoundary` 가 깨진 scene 을 격리해도 나머지 컴포넌트는 그려진 결과로 추정.

### 부정
- **클린 렌더 0/5*** (부분측정): r4 의 2/5 진보가 r5 에서 사라짐. multi-step 코드 품질의 근본 원인(evaluator default-export 실패, 1:46 sanitize) 은 미해소.
- **case 1 (500 회귀) 재발**: TM-114 sanitize 가 잡았던 패턴이 r5 에 재출현 — LLM 출력 비결정성 + sanitize 정규식의 false-negative.
- **bench 인터럽트로 case 4/5 미측정**: chart 케이스 generation 이 30s+ 소요 → bench 전체 시간이 timeout 한도 초과. 본 회차는 **추이 비교 신뢰도 부족**.

## 후속 / 다음

- [ ] **TM-108 r6 재실행 필요** — bench timeout 확장 + case 5 까지 완주 + 클린 렌더 최종 카운트. 본 r5 의 case 4/5 공백을 메워야 ADR 정량 근거 완성.
- [ ] **AI-BUG-multi-step-evaluator-unknown-eb** fix task — `<Unknown>` EB 2건이 r4→r5 동안 잔존. evaluator 의 default-export 식별 fallback 경로 디버깅. triggers_requalify=[TM-108].
- [ ] **AI-BUG-sanitize-1-46-flaky** fix task — `Unexpected token 1:46` 가 r3 → r5 사이 간헐 재발. TM-114 sanitize 정규식의 추가 케이스 (LLM 출력 variant) 확장.
- [ ] **multi-step default-off 정책 유지** — r5 도 클린 렌더 0/5* + 평균 격차 ≈20점. production 승격 불가. r6 재측정까지는 잠정 ADR 보류.
- [ ] **bench timeout/parallel 개선** — case 4 chart 가 30s gen + capture 까지 1min+ 소요. 전체 5 케이스 직렬 + judge 까지 timeout 20min 안에 빠듯 → 향후 capture 와 judge 분리 또는 case 병렬 실행 검토.

## 출처 / 링크

- 이전 회차: [[2026-04-27-TM-108-quality-benchmark|r1]] · [[2026-04-27-TM-108-quality-benchmark-r2|r2]] · [[2026-04-27-TM-108-quality-benchmark-r3|r3]] · [[2026-04-27-TM-108-quality-benchmark-r4|r4]]
- 직전 fix: [[2026-04-27-TM-116-fix|TM-116 evaluator destructure + __SceneBoundary]]
- 코드: `../../src/lib/remotion/evaluator.ts`, `../../src/lib/ai/pipeline.ts`
- 벤치 드라이버: `../../__tests__/benchmarks/tm-108-bench.ts`
- r5 부분 judge 스크립트: `../../__tests__/benchmarks/tm-108-r5-judge.ts`
- 결과(JSON+PNG): `../../__tests__/benchmarks/results/tm-108/baseline/`, `../../__tests__/benchmarks/results/tm-108/full/`
- stdout 캡처: `/tmp/tm-108-r5-baseline.out`, `/tmp/tm-108-r5-full.out`
- dev 서버 로그: `/tmp/tm-108-r5-dev.log`, `/tmp/tm-108-r5-dev-full.log`
