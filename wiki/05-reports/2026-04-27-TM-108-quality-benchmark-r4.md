---
title: "2026-04-27 — TM-108 r4 품질 벤치마크: TM-114 머지 후 최종 측정"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai/generate, bench, tm-108, tm-114, tm-111, tm-112, tm-102]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude Opus 4.7 1M)
---

# TM-108 r4 — Quality benchmark (post TM-114)

## TL;DR

TM-114 (multi-line `require` sanitize + broken destructure sweep, PR #115) 머지 직후 동일 5 케이스로 baseline(single-shot) vs full(`AI_MULTI_STEP=1`, gpt-4o)을 r4 최종 측정.

- **baseline r4**: 5/5 generate-200 + judge 5/5, **avg=72.4/100** (r1 60.0 → r2 70.6 → r3 71.8 → r4 72.4 — 안정적 미세 상승).
- **full r4 가용성**: generate-200 = **5/5** (r1 1/5 → r2 5/5 → r3 4/5 → r4 **5/5 회복**). r3 의 server 500 회귀(`SyntaxError 1:46`)는 TM-114 머지로 사라졌다.
- **full r4 렌더 품질**: **2/5 케이스는 ErrorBoundary 미노출 클린 렌더** (case 4 chart, case 5 typo). 3/5 는 여전히 EB(`<Scene1>` 1건, `<Unknown>` 2건). r3 0/5 → r4 2/5 — multi-step 경로의 첫 부분 회복.
- **full r4 평균**: **49.4/100** (r1 15.0 n=1 → r2 25.2 n=5 → r3 N/A → r4 **49.4 n=5**). 클린 렌더 2건이 평균을 끌어올림(case 5 typo=88, case 4 chart=60).
- **결론**: TM-114 는 r3 의 가용성 회귀를 완전 해소했고 multi-step 렌더 품질의 첫 의미있는 회복을 만들었다. 하지만 **render error = 0 목표는 미달** (3/5 EB) → multi-step default-off 정책 유지 권고. 추가 evaluator/composer 패치 후 r5 가치 있음.

## r1 → r2 → r3 → r4 추이 표

| 회차 | 머지 후 | baseline 200/5 | baseline avg | full 200/5 | full avg (judged n) | 클린 렌더 (full) | 비고 |
|---|---|---:|---:|---:|---:|---:|---|
| **r1** | (pre TM-111) | 5/5 | 60.0 | **1/5** | 15.0 (n=1) | 0/5 | multi-step 가용성 80% 붕괴 |
| **r2** | TM-111 sanitize+fallback | 5/5 | 70.6 | **5/5** | 25.2 (n=5) | 0/5 | `Scene1Params is not defined` 100% |
| **r3** | + TM-112 evaluator | 5/5 | 71.8 | **4/5** | n/a (manifest 유실) | 0/5 | parser 500 1건 회귀 + `<Unknown>` EB 100% |
| **r4** | + **TM-114** multi-line require | **5/5** | **72.4** | **5/5** | **49.4 (n=5)** | **2/5** | 가용성 회복 + 첫 클린 렌더 (chart, typo) |

**관찰**:
- baseline 평균은 r1→r4 동안 단조 증가(60.0 → 70.6 → 71.8 → 72.4). single-shot 경로는 production-ready.
- full 가용성은 r2 5/5 → r3 4/5 (회귀) → r4 5/5 (회복). TM-114 가 r3 의 `SyntaxError 1:46` 패턴을 정확히 잡았다.
- full 클린 렌더는 r1~r3 0/5 → r4 **2/5** — multi-step 경로의 의미있는 첫 회복. 그러나 3/5 가 여전히 EB.
- full 평균 49.4 는 baseline 72.4 와 23 점 격차 — multi-step 의 절대 품질은 아직 single-shot 미만이지만 격차가 r2(45) → r4(23) 로 절반 가까이 좁혀짐.

## 케이스별 결과 (r4)

### baseline r4 (`__tests__/benchmarks/results/tm-108/baseline/scores.json`)

| # | id | category | overall | layout | typo | motion | fidelity | overall_comment |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | tm108-1-baseline-simple | baseline-simple | **90** | 8 | 9 | 9 | 10 | 심플한 레이아웃과 명확한 색상. |
| 2 | tm108-2-long-video | long-video | **45** | 5 | 6 | 3 | 4 | 60s 단조, 핵심 가치/CTA 누락. |
| 3 | tm108-3-url-ingest | url-ingest | **74** | 8 | 7 | 6.5 | 8 | HN 스타일 일부 반영. |
| 4 | tm108-4-multi-step-chart | multi-step-chart | **65** | 7 | 8 | 5 | 6 | 차트 일부 표현. |
| 5 | tm108-5-multi-step-typo | multi-step-typo | **88** | 8.5 | 9 | 8.5 | 9 | 키네틱 타이포 + 형광 옐로 양호. |
|   | **avg** |  | **72.4** | 7.3 | 7.8 | 6.4 | 7.4 |  |

### full r4 (`__tests__/benchmarks/results/tm-108/full/scores.json`)

| # | id | gen ms | dur(f) | render | overall | layout | typo | motion | fidelity | 비고 |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|
| 1 | tm108-1-baseline-simple | 18,201 | 150 | EB `<Scene1>` | **43** | 5 | 5 | 3 | 4 | 점 8개/파란색 프롬프트 미충족. EB 콘솔. |
| 2 | tm108-2-long-video | 18,638 | 1800 | EB `<Unknown>` | **43** | 5 | 5 | 4 | 3 | 단조, 핵심 요소 누락. EB 콘솔. |
| 3 | tm108-3-url-ingest | 16,559 | 150 | EB `<Unknown>` | **13** | 2 | 1 | 1 | 1 | 거의 빈 화면. EB 콘솔. |
| 4 | tm108-4-multi-step-chart | 20,166 | 300 | **CLEAN** | **60** | 6.5 | 5.5 | 6.5 | 5.5 | EB 콘솔 0건. 차트 부분 표현. |
| 5 | tm108-5-multi-step-typo | 14,854 | 150 | **CLEAN** | **88** | 8.5 | 9 | 8.5 | 9 | EB 콘솔 0건. 키네틱 타이포 양호. |
|   | **avg** |  |  |  | **49.4** | 5.4 | 5.1 | 4.6 | 4.5 |  |

### Render error breakdown (full r4)

- `<Scene1>` ErrorBoundary 1건 (case 1)
- `<Unknown>` ErrorBoundary 2건 (case 2, 3)
- 클린 렌더 2건 (case 4 chart, case 5 typo)
- **render error 0 미달** — 5/5 클린 목표 대비 60% 실패율.

## 무엇이 바뀌었나 (r3 → r4)

- **TM-114 머지**: pipeline 의 sanitize 가 멀티라인 `const { ... } = require(...)` 와 destructure 깨진 형태를 함께 처리하도록 확장 (PR #115).
- 효과:
  1. r3 case 1 의 server 500(`SyntaxError 1:46`) 회귀가 r4 에서 200 OK 로 복구. **가용성 회복**.
  2. case 4 chart (300f, 가장 복잡한 multi-step) 와 case 5 typo (kinetic typography) 가 EB 콘솔 0 건의 클린 렌더를 달성. **첫 multi-step 클린 렌더**.
- 잔존 이슈:
  1. case 1 (`<Scene1>` EB) — 짧은 spinner 프롬프트가 evaluator 단에서 또 다른 형태로 깨짐. r3 의 `<Unknown>` 패턴과 다른 새 시그니처.
  2. case 2, 3 (`<Unknown>` EB) — r3 와 동일 패턴 잔존. evaluator 의 default-export 식별 실패 추정.

## 영향 / 분석

### 긍정 — TM-114 가 가용성 회복 + 첫 클린 렌더

- r3 의 `SyntaxError 1:46` 회귀(가장 짧은 프롬프트) 가 r4 에서 0 건 — TM-114 sanitize 확장이 정확히 그 형태를 잡음.
- multi-step 클린 렌더가 0/5 → 2/5 로 진입. case 4 chart (multi-step 의 핵심 활용 사례) 와 case 5 typo 가 모두 클린 렌더 + 의미있는 점수 (60, 88).
- baseline 점수도 r3 71.8 → r4 72.4 로 안정 상승 — 통제군이 흔들리지 않음 → 측정 신뢰성 유지.

### 부정 — 여전히 3/5 EB, render error 0 미달

- case 1, 2, 3 의 EB 는 두 패턴(`<Scene1>` 1건, `<Unknown>` 2건). evaluator 의 fallback 익명 컴포넌트 경로가 살아있음.
- multi-step 평균(49.4) 은 baseline(72.4) 대비 23 점 낮음 — 클린 렌더 2건 외에는 프롬프트 충실도가 매우 낮음.
- 즉 multi-step 은 **chart + typography 같은 풍부한 사양 prompt 에서만 부가가치**, 짧고 단순한 prompt(case 1) 나 long-form composition(case 2) 에서는 오히려 손해.

### 측정 인프라 개선

- r3 회차 manifest 유실 사고 이후, r4 는 worktree 내 격리된 results 경로에 정상 저장. r3 의 `bench infra fix` 후속이 아직 미적용이지만 동시 실행 worktree 가 없어 충돌 회피.

## 후속 / 다음

- [ ] **multi-step default-off 정책 유지** — render error 3/5 + 평균 격차 23 점 → production 승격 불가. 본 r4 데이터로 ADR 수립 권고 (multi-step 은 opt-in 실험 플래그).
- [ ] **AI-BUG-multi-step-evaluator-eb** (잔존 EB 경로) fix task — case 1 `<Scene1>` + case 2/3 `<Unknown>` 두 패턴을 함께 다룸. 가설:
  1. evaluator 가 multi-step composer 의 export 패턴(default export 부재 또는 named-only) 을 처리 못함 → fallback 익명 컴포넌트.
  2. case 1 의 `<Scene1>` 은 Scene 컴포넌트 자체에서 throw — props/ref 검사 누락 가능.
  triggers_requalify=[TM-108]. 머지 시 r5 자동 재실행.
- [ ] **bench infra 격리** (TM-108 r3 후속 잔여) — results 경로 PID/branch suffix.
- [ ] [[../02-dev/status|status.md]] 업데이트 (multi-step 가용성 5/5 회복, 클린 렌더 2/5 진입).

## 출처 / 링크

- 이전 회차: [[2026-04-27-TM-108-quality-benchmark|r1]] · [[2026-04-27-TM-108-quality-benchmark-r2|r2]] · [[2026-04-27-TM-108-quality-benchmark-r3|r3]]
- 직전 fix: [[2026-04-27-TM-114-fix|TM-114 multi-line require sanitize]]
- 코드: `../../src/lib/ai/pipeline.ts`, `../../src/lib/remotion/evaluator.ts`
- 벤치 드라이버: `../../__tests__/benchmarks/tm-108-bench.ts`
- 결과(JSON+PNG): `../../__tests__/benchmarks/results/tm-108/baseline/`, `../../__tests__/benchmarks/results/tm-108/full/`
- stdout 캡처: `/tmp/tm-108-r4-baseline.out`, `/tmp/tm-108-r4-full.out`
- dev 서버 로그: `/tmp/tm-108-r4-dev.log`, `/tmp/tm-108-r4-dev-full.log`
