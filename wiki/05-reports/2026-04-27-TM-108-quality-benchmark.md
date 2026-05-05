---
title: "2026-04-27 — TM-108 품질 벤치마크: baseline vs 풀 파이프라인 (multi-step + RAG + URL ingest)"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai/generate, bench, tm-108, tm-102, tm-103, tm-104, tm-105]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude Opus 4.7)
---

# TM-108 — Quality benchmark

## TL;DR

TM-102(multi-step) + TM-103(URL ingest) + TM-104(long video) + TM-105(dynamic clarify) 의
**효과를 합산 측정**하기 위해 5 케이스에 대해 baseline(single-shot, no flags) vs full(`AI_MULTI_STEP=1`)
을 동일 프롬프트·동일 judge(gpt-4o, TM-66 4축 루브릭)로 비교했다.

- **baseline avg = 60.0/100** — 5/5 생성 성공, 5/5 judge 완료
- **full avg = 15.0/100** — **5건 중 4건 generate 500 (sandbox/transpile 실패)**, 1건만 judge 가능 (15 점 = 에러 화면)
- **결론**: 현 상태에서 multi-step 을 default-on 으로 돌리면 **품질 회귀가 아니라 가용성 붕괴**.
  TM-102 의 `AI_MULTI_STEP=1` 경로는 **gpt-4o 모델에서 sandbox 정책과 충돌** — `Forbidden: require`,
  `Forbidden: globalThis`, transpile 단계의 syntax error 가 4/5 케이스에서 재현됨.
- 권고: **multi-step default-off 유지**. TM-102 sandbox/composer 가 gpt-4o output 을 안전하게 정규화하도록
  보강한 뒤 재측정. URL ingest(TM-103) 는 baseline 경로에서 정상 동작 — 색감 반영도 judge 가 확인.

## 무엇이 바뀌었나

- 새 벤치마크 드라이버: `__tests__/benchmarks/tm-108-bench.ts`
  - 5 케이스 (1 baseline-simple, 1 long-video 60s, 1 URL-ingest, 2 multi-step-heavy)
  - 2 프레임(90/180) 캡처, gpt-4o multimodal judge, 4축 (layout/typo/motion/fidelity)
  - mode 별 격리 출력: `__tests__/benchmarks/results/tm-108/<baseline|full>/`
- 결과 산출물:
  - `__tests__/benchmarks/results/tm-108/baseline/{manifest,scores}.json` + 10 PNG
  - `__tests__/benchmarks/results/tm-108/full/{manifest,scores}.json` + 2 PNG
- 본 보고서.

## 왜 / 배경

TM-102 retro 결론(2026-04-27): "multi-step 5/5 success on Sonnet, ~16% longer code, 2.3× wall ms,
**시각 품질 uplift 는 TM-46 r7 RAG 비교가 우선**". 이후 TM-103/104/105 가 입력 측 보강을 마쳤지만
"다 켰을 때" 의 합산 품질을 확인한 적은 없었다. TM-108 은 이 공백을 메우는 5-케이스 smoke.

## 케이스별 결과 표

| # | id                       | category         | baseline | full       | Δ      | full failure                                          |
|---|--------------------------|------------------|----------|------------|--------|-------------------------------------------------------|
| 1 | tm108-1-baseline-simple  | baseline-simple  | **90**   | n/a (500)  | -      | `Unexpected token, expected "(" (3:14)` (transpile)   |
| 2 | tm108-2-long-video       | long-video       | **50**   | **15**     | -35    | (생성 OK 1800f) judge: 빈 화면, error-boundary 추정    |
| 3 | tm108-3-url-ingest       | url-ingest       | **70**   | n/a (500)  | -      | `TM-102 scene-code[1] failed sandbox: Forbidden: require` |
| 4 | tm108-4-multi-step-chart | multi-step-chart | **15**   | n/a (500)  | -      | `TM-102 scene-code[0] failed sandbox: Forbidden: globalThis` |
| 5 | tm108-5-multi-step-typo  | multi-step-typo  | **75**   | n/a (500)  | -      | `TM-102 scene-code[3] failed sandbox: Forbidden: require` |
|   | **avg**                  |                  | **60.0** | **15.0***  | **−45**| *full=avg of 1 case (n=1)                             |

### baseline judge 코멘트 (요약)

| id | layout | typo | motion | fidelity | overall_comment |
|---|---:|---:|---:|---:|---|
| 1 | 8.0 | 9.0 | 9.0 | 10.0 | 깔끔하고 일관된 디자인. |
| 2 | 5.0 | 6.0 | 4.0 | 5.0 | 핵심 가치/CTA 미반영. 모션 단조. |
| 3 | 7.0 | 8.0 | 6.0 | 7.0 | HN 색감 일부 반영, 색 활용 부족. |
| 4 | 2.0 | 2.0 | 1.0 | 1.0 | **빈 화면** — 차트 렌더 실패 (baseline 경로도 복잡 인포그래픽 약함). |
| 5 | 7.5 | 8.5 | 6.5 | 7.5 | "MOVE FAST. SHIP THINGS." 잘 반영. 모션 다양성 부족. |

### full judge 코멘트

| id | overall_comment |
|---|---|
| 2 | 오류로 인해 영상 내용이 보이지 않음 (error boundary). 평가 불가. |

## 영향

### 긍정 (baseline 경로의 강점 확인)

- **단순/타이포 케이스 (1, 5) 는 75-90 점**: single-shot + RAG 만으로도 의도에 충실한 결과.
- **URL ingest (3) 는 70 점**: TM-103 의 `[ATTACHED CONTEXT]` 블록 append 패턴이 **system-prompt cache key 를 깨지 않으면서**
  색감/문구 반영을 끌어냄 — 설계대로 동작.

### 부정 (full 경로의 회귀)

- **TM-102 multi-step + gpt-4o = 80% 가용성 붕괴**.
  - 모델이 scene-code 단계에서 `require(...)`, `globalThis.*` 같은 Node-isms 를 빈번히 출력.
  - sandbox validator (의도된 보호) 는 정상이지만, **composer/post-processor 가 이런 토큰을 사후 제거하지 못함**.
  - case 1 은 transpile 단계까지 갔으나 syntax error — composer 가 만든 wrapper 와 scene snippet 이
    토큰 경계에서 충돌한 것으로 추정 (`expected "(" at line 3 col 14`).
- **long-video (case 2) 는 1800f 생성에 성공했으나 judge 점수 15** — 90/180 프레임이 모두 빈/에러 화면.
  multi-step 은 outline → scene-spec → scene-code → compose 4단계 후 클라이언트 렌더에서 즉시 throw,
  ErrorBoundary 만 보임. 실제 콘텐츠 검증 불가.
- **단일 케이스(n=1) 만으로 full 평균을 내는 것은 통계적으로 무의미** — 본 표의 -45 Δ 는 "uplift 부재" 가
  아니라 **"파이프라인이 거의 항상 throw 한다"** 는 가용성 신호로 읽어야 함.

### 비용/시간

- 본 벤치 1 회 비용: gpt-4o 생성 5+5 호출 + judge 6 호출 (multimodal) ≈ **$1.4 OpenAI**.
- baseline 평균 generation latency: 10.7s (5.8 ~ 18.4s).
- full 평균 latency (성공 1건만): 22.5s — 예상대로 2× 이상.

## Claude artifact 와의 비교 권고 (정성)

사용자 피드백 ("Claude artifact 수준 원함") 대비:

- **현재 도달점 (baseline)** — 단순/타이포 90 점, 인포그래픽 15 점. artifact 수준의 차트/멀티-씬 인포는 미달.
- **multi-step 가설** — outline → scene 분할은 옳은 방향이지만 **gpt-4o 의 코드 출력 위생 (no `require`, no `globalThis`)
  이 보장되지 않음**. Anthropic Sonnet 에서 5/5 success 였던 TM-102 retro 와의 격차가 모델 차이에서 비롯됨을 시사.
- **차기 우선순위 제안**:
  1. (필수) TM-102 composer 에 **post-validation auto-fix** 단계 추가 — `require/globalThis/import` 등
     금지 토큰을 sanitize 하거나 해당 scene 만 폐기 후 single-shot fallback.
  2. (필수) 모델 스위치 정책 — `AI_MULTI_STEP=1` + `AI_PROVIDER=anthropic` 조합으로만 default-on 검토,
     OpenAI 경로는 sandbox 빠져나갈 때까지 hold.
  3. (선택) 인포그래픽 카테고리 (case 4) 는 baseline 경로에서도 약함 → RAG reference 보강 (TM-74) 또는
     인포그래픽 전용 system-prompt addendum.

## 관련 task / artifact

- 의존: TM-102 (`wiki/05-reports/2026-04-27-TM-102-fix.md`), TM-103, TM-104, TM-105
- judge 인프라: TM-66 (`wiki/05-reports/2026-04-27-TM-66-retro.md`)
- 전구체 visual judge: TM-46 r7 (RAG ablation)

## Test plan (PR 검증 가이드)

- [ ] `__tests__/benchmarks/tm-108-bench.ts` 의 코드 형태/lint 만 확인 (라이브 실행은 비용 발생, 별도 trigger).
- [ ] `results/tm-108/baseline/scores.json` 에 5개 결과, avg=60 기록되어 있음.
- [ ] `results/tm-108/full/scores.json` 에 1개 결과, avg=15 (failure mode 기록) 기록되어 있음.
- [ ] full manifest.json 에 sandbox/transpile error 메시지가 명확히 보존되어 있음 (재현용).
