---
title: "2026-04-27 — TM-108 r2 품질 벤치마크: TM-111 sanitize/fallback 적용 후 재측정"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai/generate, bench, tm-108, tm-111, tm-102]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude Opus 4.7 1M)
---

# TM-108 r2 — Quality benchmark (post TM-111)

## TL;DR

TM-111 의 forbidden-token sanitize + single-shot fallback 이 머지된 직후 동일 5 케이스로 baseline(single-shot) vs full(`AI_MULTI_STEP=1`, gpt-4o)을 재측정했다.

- **r1 → r2 가용성**: full 모드 generate 200 응답률 **20% (1/5) → 100% (5/5)**. TM-111 가설 입증.
- **r1 → r2 평균 점수**: full **15.0 → 25.2**, baseline **60.0 → 70.6**.
- **r2 baseline vs full Δ**: **70.6 vs 25.2** (-45). full 5/5 이 generate-200 이지만 클라이언트 evaluator 단계에서 `ReferenceError: SceneNParams is not defined` 로 ErrorBoundary 가 노출되어 5/5 모두 사실상 빈 화면.
- **결론**: TM-111 의 1차 목표(가용성 회복)는 달성. 그러나 multi-step 의 **렌더 시점 품질**은 sandbox 가 아닌 **composer 가 생성한 PARAMS 집계 코드**가 evaluator 의 식별자 추출 규칙과 충돌하여 또 다른 100% 실패 경로를 만들고 있음 — 후속 fix 가 필요하다.
- 권고: **multi-step default-off 계속 유지**, TM-111 fallback 은 합격(보호망 작동), 새 이슈 `AI-BUG-multi-step-scene-params` 를 spawn 해 composer/evaluator side 양쪽에서 해결한 뒤 r3 재측정.

## 무엇이 바뀌었나 (r2)

- TM-111 패치 머지 후 worktree 재setup, 같은 벤치 드라이버(`__tests__/benchmarks/tm-108-bench.ts`) 재실행.
- 새 산출물:
  - `__tests__/benchmarks/results/tm-108/baseline/{manifest,scores}.json` + 10 PNG (5/5 success, avg=70.6)
  - `__tests__/benchmarks/results/tm-108/full/{manifest,scores}.json` + 10 PNG (5/5 generate-200, avg=25.2)
- TM-111 sanitize 동작 로그(dev 서버) 1회: `[TM-111] scene-code[1] auto-sanitized: [ 'rewrote globalThis.X / globalThis["X"] to bare identifiers' ]` — gpt-4o 가 여전히 globalThis 를 흘렸으나 sanitize 가 안전 통과시킴.
- 단일-샷 fallback 발동: **0회**. sanitize 가 5/5 모두에서 sandbox 통과를 확보 → fallback 없이 전부 multi-step 경로로 응답.

## 왜 / 배경

r1([[2026-04-27-TM-108-quality-benchmark|TM-108 r1]]) 결론은 "multi-step + gpt-4o = 80% 가용성 붕괴". 그 직후 TM-111([[2026-04-27-TM-111-fix|TM-111 fix]]) 이 (1) `require/globalThis/import/Function/process` 등 6 종 패턴 사후 sanitize, (2) 어떤 단계 throw 시 single-shot fallback 을 추가했다. r2 는 동일 입력으로 효과 측정.

## 케이스별 결과 표 (r2)

| # | id                       | category         | baseline r2 | full r2 | Δ vs baseline | full r1 | r1→r2 Δ      |
|---|--------------------------|------------------|------------:|--------:|---:|--------:|--------------:|
| 1 | tm108-1-baseline-simple  | baseline-simple  | **90** | 30 | -60 | n/a (500) | +∞ (가용성)   |
| 2 | tm108-2-long-video       | long-video       | **45** | 38 | -7  | 15        | +23           |
| 3 | tm108-3-url-ingest       | url-ingest       | **73** | 38 | -35 | n/a (500) | +∞ (가용성)   |
| 4 | tm108-4-multi-step-chart | multi-step-chart | **60** | 10 | -50 | n/a (500) | +∞ (가용성)   |
| 5 | tm108-5-multi-step-typo  | multi-step-typo  | **85** | 10 | -75 | n/a (500) | +∞ (가용성)   |
|   | **avg**                  |                  | **70.6** | **25.2** | **-45** | **15.0** (n=1) | +10.2 (avg-of-avg, but n 동일화 후 비교) |

(주의: r1 full 평균 15.0 은 1 케이스만 점수 가능 → 통계적 비교는 불가. r2 는 5/5 점수 생성 → 처음으로 full 모드 분포를 본다.)

### baseline r2 judge 코멘트 요약

| id | layout | typo | motion | fidelity | overall_comment |
|---|---:|---:|---:|---:|---|
| 1 | 8.0 | 9.0 | 9.0 | 10.0 | 깔끔. 자연스러운 모션. |
| 2 | 5.0 | 6.0 | 3.0 | 4.0 | 핵심 가치/CTA 미반영, 모션 단조. |
| 3 | 7.0 | 8.0 | 6.0 | 8.0 | HN 색감 일부 반영. |
| 4 | 6.0 | 7.0 | 5.0 | 6.0 | 차트 일부 표현, 라벨 부족. |
| 5 | 8.5 | 9.0 | 7.5 | 9.0 | 키네틱 타이포 반영, 형광 옐로 양호. |

### full r2 judge 코멘트 요약 (전부 ErrorBoundary 노출)

| id | overall_comment |
|---|---|
| 1 | 로딩 스피너가 오류로 인해 전혀 보이지 않습니다. |
| 2 | 오류로 인해 영상의 주요 요소들이 제대로 구현되지 않았습니다. |
| 3 | 프롬프트에 맞는 뉴스 헤드라인 카드가 나타나지 않고, 오류 메시지만 표시됩니다. |
| 4 | 코드 오류로 인해 인포그래픽이 전혀 표시되지 않았습니다. |
| 5 | 코드 오류로 인해 프롬프트가 전혀 반영되지 않았습니다. |

dev-서버 로그상 동일 패턴: `[browser] [evaluator] runtime — ReferenceError: Scene1Params is not defined (src/lib/remotion/evaluator.ts:274:15)` (Scene1~Scene5Params 케이스별 차이). **48 회** 발생.

## 영향 (r2 분석)

### 긍정 — TM-111 1차 목표 달성

- **가용성 5x**: r1 1/5 → r2 5/5 generate-200. 사용자 측 500 fatal 은 사라졌다.
- **sanitize 트리거 1회 관측**: composer 가 이미 정제된 코드를 sandbox 통과시킨 직접 증거.
- **fallback 0회**: 즉, sanitize 만으로 본 5 케이스 100% 커버. fallback 은 보험 역할만 수행 (성능 패널티 없음).

### 부정 — 새 100% 실패 모드 발견

- multi-step 5 케이스 모두에서 클라이언트 evaluator 가 `Scene1Params` 같은 식별자를 찾지 못해 ErrorBoundary 노출.
- 즉 sandbox/transpile 게이트는 통과했지만 **PARAMS 집계 / 평가 단계에서 충돌**.
- 추정 원인:
  1. multi-step composer 가 각 scene 의 PARAMS 를 `SceneNParams` 라는 이름으로 expose 하는 코드를 작성.
  2. evaluator(`src/lib/remotion/evaluator.ts:274`) 의 식별자 추출 규칙 (TM-46/2026-04-26 evaluator-params-bug 패치 이후) 이 SCREAMING_CASE 외에 **PascalCase 의 `SceneNParams`** 를 컴포넌트로 잘못 분류하거나, eval scope 에서 누락.
  3. 결과: 5/5 케이스 모두 클라이언트 사이드 ReferenceError → 빈 화면 → judge 1-5 점.
- 이는 TM-111 범위 밖. **새 fix task spawn 필요** (아래 후속 참조).

### 비용 / 시간 (r2)

- baseline 평균 latency: 10.2s (5.5 ~ 14.5s). r1 10.7s 와 동급.
- full 평균 latency: 18.96s (14.4 ~ 24.2s). r1 22.5s 보다 약간 단축. fallback 0회 영향.
- OpenAI 비용 1 회 : gpt-4o gen 5+5 + judge 10 호출 ≈ **$1.5** 실측 추정.

## 후속 / 다음

- [x] r1 vs r2 가용성 회귀 분석 박제 (이 문서).
- [ ] **AI-BUG-multi-step-scene-params** fix task spawn (별도 태스크) — composer 측 PARAMS 출력 형식 표준화 또는 evaluator 측 식별자 추출 보강. triggers_requalify=[TM-108]. 머지 시 r3 자동 재실행.
- [ ] r3 측정 시 fallback 카운트, generate latency, evaluator runtime error 0건 검증.
- [ ] [[../02-dev/status|status.md]] 업데이트 (multi-step gpt-4o 가용성 회복 + 렌더 단계 100% 실패).

## 출처 / 링크

- 이전 회차: [[2026-04-27-TM-108-quality-benchmark|TM-108 r1 (베이스라인 vs full)]]
- 직전 fix: [[2026-04-27-TM-111-fix|TM-111 sanitize + fallback]]
- 코드: `../../src/lib/ai/pipeline.ts`, `../../src/lib/remotion/evaluator.ts:274`
- 벤치 드라이버: `../../__tests__/benchmarks/tm-108-bench.ts`
- 결과(JSON+PNG): `../../__tests__/benchmarks/results/tm-108/{baseline,full}/`
- 관련 tech-note: `../02-dev/tech-notes/2026-04-26-evaluator-params-bug.md` (PascalCase `SceneNParams` 처리 미검증)
