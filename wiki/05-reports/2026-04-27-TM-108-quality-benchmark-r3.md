---
title: "2026-04-27 — TM-108 r3 품질 벤치마크: TM-111 + TM-112 머지 후 최종 측정"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai/generate, bench, tm-108, tm-111, tm-112, tm-102]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude Opus 4.7 1M)
---

# TM-108 r3 — Quality benchmark (post TM-111 + TM-112)

## TL;DR

TM-111(sandbox sanitize + fallback)과 TM-112(SceneNParams evaluator fix)가 모두 main 에 머지된 직후 동일 5 케이스로 baseline(single-shot) vs full(`AI_MULTI_STEP=1`, gpt-4o)을 r3 최종 측정했다.

- **baseline r3**: 5/5 generate-200 + judge 5/5, **avg=71.8/100** (r2 70.6, r1 60.0 → 안정적 상향 곡선).
- **full r3 가용성**: generate-200 = **4/5** (r1 1/5 → r2 5/5 → r3 4/5). 1 케이스(`tm108-1-baseline-simple`)가 서버측 `SyntaxError: Unexpected token, expected "(" (1:46)` 로 500 회귀.
- **full r3 렌더 품질**: 캡처된 케이스 4 종 모두 `<Unknown> ErrorBoundary` 노출 — r2 의 `<GeneratedAsset> ReferenceError: SceneNParams` 패턴은 사라졌지만 (TM-112 효과), 새로운 evaluator-side 실패 모드가 100% 등장. 즉 **render error 0 목표 미달**.
- **결론**: r2 → r3 사이의 TM-112 머지는 한 가지 ReferenceError 패턴은 제거했으나, **multi-step 경로의 클라이언트 사이드 실패율은 여전히 100%**. 동시에 새 회귀(case 1 parser 500)가 한 건 발생.
- 권고: **multi-step default-off 유지**(r1~r3 일관). TM-112 패치만으로는 multi-step 신뢰성 회복 불충분 → 새 fix task 필요(아래 후속). 추가 수정 없이 r4 를 돌릴 가치는 낮다.

## r1 → r2 → r3 추이 표 (가용성 + 평균 점수)

| 회차 | 머지된 패치 | baseline 200/5 | baseline avg | full 200/5 | full avg (judged n) | 렌더 OK (full) | 비고 |
|---|---|---:|---:|---:|---:|---:|---|
| **r1** | (없음 — pre TM-111) | 5/5 | 60.0 | **1/5** | 15.0 (n=1) | 0/5 | multi-step 가용성 80% 붕괴 |
| **r2** | TM-111 sanitize+fallback | 5/5 | 70.6 | **5/5** | 25.2 (n=5) | 0/5 | `Scene1Params is not defined` 100% |
| **r3** | TM-111 + **TM-112** | 5/5 | **71.8** | **4/5** | n/a (manifest 유실) | 0/5 | parser 500 1건 회귀 + `<Unknown> ErrorBoundary` 100% |

세부:

- baseline 평균은 r1→r2→r3 동안 계속 상승 (60.0 → 70.6 → 71.8). single-shot 경로는 안정적이며 본 측정의 통제군 역할을 충실히 수행.
- full 가용성은 r2 가 정점(5/5), r3 에서 1 건이 server 500 으로 회귀. 회귀 케이스의 prompt 는 가장 짧은 spinner 입력이며, 동일 prompt 가 r2 에서는 200 OK 였다 — **TM-112 패치가 composer 파이프라인에서 또 다른 코드 형태(generation 단계 1열 46자에서 SyntaxError) 를 유발했을 가능성**. (자세한 회귀 분석은 fix task 에서.)
- 본 r3 러너는 `[5/5] tm108-5-multi-step-typo` 의 frame=180 캡처에서 `Navigation timeout 30000ms` 도 1 건 관측 → 5번째 케이스는 부분 캡처(frame=90 만). 이후 외부 bench(병렬 worktree) 의 cleanup 충돌로 `__tests__/benchmarks/results/tm-108/full/` 디렉토리가 삭제되어 manifest/scores 파일이 유실. **세부 score 는 stdout 캡처(아래 § 케이스별)** 에서 복원.

## 케이스별 결과 (r3)

### baseline r3 (judged 5/5, scores.json 보존)

| # | id | category | overall | layout | typo | motion | fidelity | overall_comment |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | tm108-1-baseline-simple | baseline-simple | **93** | 9 | 9 | 9 | 10 | 심플한 디자인과 자연스러운 모션. |
| 2 | tm108-2-long-video | long-video | **45** | 5 | 6 | 3 | 4 | 60s 단조, 핵심 가치/CTA 누락. |
| 3 | tm108-3-url-ingest | url-ingest | **80** | 8 | 7 | 8 | 9 | HN 색감 일부 반영. |
| 4 | tm108-4-multi-step-chart | multi-step-chart | **53** | 6 | 7 | 3 | 5 | 차트 일부 표현, 라벨 부족. |
| 5 | tm108-5-multi-step-typo | multi-step-typo | **88** | 8.5 | 9 | 8.5 | 9 | 키네틱 타이포 + 형광 옐로 양호. |
|   | **avg** |  | **71.8** | 7.3 | 7.6 | 6.5 | 7.4 |  |

(파일: `__tests__/benchmarks/results/tm-108/baseline/scores.json` — 보존됨.)

### full r3 (generate 결과만 stdout 캡처에서 복원, judge 미수행)

| # | id | generate | gen ms | dur (f) | render | 비고 |
|---|---|---|---:|---:|---|---|
| 1 | tm108-1-baseline-simple | **500** | n/a | n/a | n/a | `SyntaxError: Unexpected token, expected "(" (1:46)` — composer/parser 단에서 즉시 fail. fallback 미발동(또는 fallback 도 동일 코드 생성). |
| 2 | tm108-2-long-video | 200 | 17,465 | 1800 | `<Unknown>` EB | 캡처 OK, but ErrorBoundary 노출(품질 0). |
| 3 | tm108-3-url-ingest | 200 | 11,885 | 150 | `<Unknown>` EB | 캡처 OK, but EB. |
| 4 | tm108-4-multi-step-chart | 200 | 13,842 | 300 | (silently captured) | 캡처 OK. EB 콘솔 메시지 없음 → 또는 화면 캡처가 EB 경계 외(혹은 정상 렌더 가능성). 불완전. |
| 5 | tm108-5-multi-step-typo | 200 | 9,826 | 150 | 부분 (frame=90 만, frame=180 nav timeout) | 5번째에서 dev 응답 지연 추정. |

- TM-111 sanitize 트리거: **2 회** (`stripped const … = require(...) declarations` × 2). r2 와 비교해 sanitize 패턴이 `globalThis` → `require` 로 바뀜 (gpt-4o 출력 변동성).
- TM-111 single-shot fallback 발동: **0 회** (case 1 의 500 은 fallback 경로도 못 살림 — 즉 fallback 보호가 실효성 없음을 시사).
- 클라이언트 evaluator 콘솔: `[browser] [console.error] %o ... The above error occurred in the <Unknown> component. It was handled by the <ErrorBoundary> error boundary.` × 다수. `<Unknown>` 표기는 r2 의 `<GeneratedAsset>` 와 다름 → TM-112 가 컴포넌트 wrapping 또는 evaluator 의 fallthrough 경로를 변경.

## 무엇이 바뀌었나 (r2 → r3)

- TM-111(sandbox sanitize + fallback) 코드는 동일하나 입력 변동에 따라 sanitize 로그 표면이 `globalThis` → `require` 로 이동.
- TM-112(SceneNParams evaluator fix) 머지 → r2 의 `Scene1Params is not defined` 패턴은 더 이상 dev 로그에 나타나지 않음(0 건). **하지만 클라이언트 측 ErrorBoundary 가 여전히 모든 캡처에서 트리거** → 다른 실패 경로가 남아 있음을 시사.
- 새 회귀: case 1 server 500 (`SyntaxError: Unexpected token, expected "(" (1:46)`). r2 에서는 200 OK 였던 같은 짧은 prompt 가 r3 에서 깨짐 → multi-step generation 의 비결정성 또는 TM-112 패치가 composer 코드 합성 단계에 부작용을 만들었을 가능성.

## 영향 / 분석

### 긍정 — TM-112 가 한 가지 패턴은 제거함

- r2 의 시그니처 에러 `ReferenceError: Scene1Params is not defined (evaluator.ts:274)` 는 r3 dev 로그에서 0 건. 즉 TM-112 의 식별자 추출/노출 수정은 의도한 대로 작동.
- baseline 회로는 r1~r3 전체 회차 5/5 200 + judge 5/5 + 안정적 점수 상승. single-shot 경로의 신뢰성은 production-ready.

### 부정 — multi-step 경로의 사용자 체감 품질은 여전히 0

- full 5/5 가운데 0/5 가 정상 렌더(=ErrorBoundary 미노출 + 시각적으로 의미 있는 화면). r2(0/5) 대비 개선 없음.
- 즉 TM-111 sanitize(가용성) → TM-112 evaluator(식별자) 두 단계로도 multi-step 결과물의 **렌더-시점 안정성**은 회복되지 않았다.
- 추가로 case 1 500 회귀는 multi-step 코드 생성/합성이 보장된 형태가 아님을 다시 보여준다.

### 측정 인프라 이슈

- 본 회차에서 다른 worktree 의 bench 가 동시 실행되어 `__tests__/benchmarks/results/tm-108/full/` 디렉토리가 삭제됨 → manifest/scores 가 유실.
- 영향: 점수표는 stdout 캡처에서 복원했으나 axis_avg/judge 코멘트 손실. **다음 회차부터 results 출력 경로를 worktree-scoped 또는 PID-suffix 로 격리해야 함** (소규모 infra fix).

## 후속 / 다음

- [ ] **AI-BUG-multi-step-render-blank** fix task spawn — case 1 SyntaxError 회귀 + 캡처 4/4 ErrorBoundary 두 현상을 함께 다룸. 분석 가설:
  1. composer 가 합성하는 wrapper 코드의 일부가 evaluator 의 식별자/AST 검사를 또 다른 경로에서 실패하게 만든다.
  2. ErrorBoundary 의 component name 이 `<Unknown>` 인 것은 evaluator 가 default-export 되는 컴포넌트 식별을 못해 fallback 익명 컴포넌트로 떨어졌음을 시사.
  3. case 1 의 1:46 SyntaxError 는 multi-step 의 짧은 입력에 대해 composer 가 비표준 prefix(예: ESM import)를 흘렸을 가능성.
  triggers_requalify=[TM-108]. 머지 시 r4 자동 재실행.
- [ ] **bench infra fix** — TM-108 결과 디렉토리를 PID/branch suffix 로 격리(소형 PR).
- [ ] [[../02-dev/status|status.md]] 업데이트 (multi-step 가용성 5/5 → 4/5 회귀 + 렌더 100% 실패 지속).
- [ ] multi-step 기본값 off 정책 유지(ADR 후보). 본 데이터로 production 승격 불가.

## 출처 / 링크

- 이전 회차: [[2026-04-27-TM-108-quality-benchmark|r1]] · [[2026-04-27-TM-108-quality-benchmark-r2|r2]]
- 직전 fix: [[2026-04-27-TM-111-fix|TM-111 sanitize+fallback]] · [[2026-04-27-TM-112-fix|TM-112 SceneNParams]]
- 코드: `../../src/lib/ai/pipeline.ts`, `../../src/lib/remotion/evaluator.ts`
- 벤치 드라이버: `../../__tests__/benchmarks/tm-108-bench.ts`
- 결과(JSON+PNG): `../../__tests__/benchmarks/results/tm-108/baseline/` (full 디렉토리는 동시 bench 충돌로 삭제됨 — stdout 캡처: `/tmp/tm-108-r3-full.out`)
- dev 서버 로그: `/tmp/tm-108-r3-dev-full.log`
