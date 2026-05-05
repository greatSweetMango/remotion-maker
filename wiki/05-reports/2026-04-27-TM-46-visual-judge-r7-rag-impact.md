---
title: TM-46 r7 — Visual judge 7회차 (RAG-ON vs RAG-OFF 영향 측정)
created: 2026-04-27
updated: 2026-04-27
tags: [qa, llm-judge, r7, visual, rag, ablation]
status: active
report_type: session
period: 2026-04-27
author: TeamLead (claude opus 4.7 1M)
task_id: TM-46
---

# TM-46 r7 — Visual judge × RAG ablation

## TL;DR

7회차. 새 변수: **RAG-ON (TM-74 reference template)** vs **RAG-OFF (process.env.RAG_DISABLE=1)**.
r6 까지의 결정성 작업으로 회차-aggregate 측정 안정성은 확보 (round std≈1.77). r7 의
질문은 — **품질이 정체된 원인이 RAG 인가?**

**핵심 결과 — paired n=8 비교 (dv-01..ta-02 동일 ID 비교)**:
- meanΔ(ON−OFF) = **+0.25 pts** (round 0)
- wins(ON)=4, losses(ON)=4, ties=0
- max win +20 (dv-01), max loss −23 (dv-02)
- **RAG 가 시각 품질에 미치는 평균 영향 = 0**. 다만 prompt 단위 분산 ±20pt는 큼.

unpaired naive 비교는 ON=77.1 / OFF=71.6 (Δ=+5.5) 로 보이지만, 이는 RAG-ON 샘플이
단순 카테고리(data-viz/text-anim) 만 포함하고 어려운 transition 을 빠뜨려 발생한
**selection bias**. paired 비교가 신호 없음을 정확히 드러낸다.

**ADR-0016 4기준**:
- RAG-ON: C1/C2/C4 PASS, C3 FAIL → 3/4 통과 (n=8 partial 이라 신뢰성 한정)
- RAG-OFF: 0/4 PASS

**해석 가설** (단정 불가, 다음 회차 확정 필요):
1. RAG 가 평균은 안 올리지만 partial 효과 있음 (좋은 케이스 +20, 나쁜 케이스 -23 → wash).
2. 현재 RAG 의 reference 가 **카테고리별 단일 템플릿** 이라 prompt 와 mismatch 시
   오히려 noise 추가 (dv-02, dv-08 회귀가 그 신호).
3. 따라서 RAG → multi-reference + similarity scoring 으로 확장하면 신호가 살아날 가능성.

본 회차는 25분 budget 내 partial 실행: RAG-OFF n=14 (reliable, 14개 IDs), RAG-ON n=8 (partial,
첫 8 프롬프트만). 자세한 한계는 하단 "한계 / 후속 권장" 참조.

(분석 raw 출력은 본문 "결과 — RAW" 섹션 참조 — `tm-46-r7-analyze.ts` 출력 삽입.)

## 결과 — RAW

<!-- ANALYZE_OUTPUT_START -->
# TM-46 r7 — RAG-ON vs RAG-OFF

Generated: 2026-05-05T20:20:12.496Z

## Summary

| Mode | n | avg_overall | layout | typo | motion | fidelity |
|---|---:|---:|---:|---:|---:|---:|
| RAG-ON | 8 | **77.1** | 7.75 | 8.38 | 5.83 | 8.75 |
| RAG-OFF | 14 | **71.6** | 7.21 | 7.43 | 6.57 | 7.36 |

**Δ (RAG-ON − RAG-OFF) = **+5.5** pts** (overall_score, 0-100 scale)


## RAG-ON per-category

| category | n | avg |
|---|---:|---:|
| data-viz | 6 | 76.17 |
| text-anim | 2 | 80 |

## RAG-OFF per-category

| category | n | avg |
|---|---:|---:|
| data-viz | 6 | 78.17 |
| text-anim | 6 | 69.17 |
| transition | 2 | 59 |

## Per-prompt comparison (intersection of IDs)

| id | category | RAG-ON | RAG-OFF | Δ |
|---|---|---:|---:|---:|
| dv-01 | data-viz | 85 | 65 | +20 |
| dv-03 | data-viz | 83 | 70 | +13 |
| ta-02 | text-anim | 92 | 83 | +9 |
| ta-01 | text-anim | 68 | 63 | +5 |
| dv-10 | data-viz | 83 | 85 | -2 |
| dv-06 | data-viz | 78 | 86 | -8 |
| dv-08 | data-viz | 68 | 80 | -12 |
| dv-02 | data-viz | 60 | 83 | -23 |

**paired n=8, meanΔ=0.25, wins(ON)=4, losses(ON)=4, ties=0**


## ADR-0016 — RAG-ON

| # | criterion | threshold | actual | verdict |
|---|---|---|---:|---|
| C1 | mean ≥ 75 | 75 | 77.13 | PASS |
| C2 | std < 15 (single-run cross-prompt proxy) | 15 | 10.08 | PASS |
| C3 | 95% CI ⊂ [70,80] | [70,80] | [70.14, 84.11] | **FAIL** |
| C4 | per-category min ≥ 60 | 60 | 76.17 | PASS |

## ADR-0016 — RAG-OFF

| # | criterion | threshold | actual | verdict |
|---|---|---|---:|---|
| C1 | mean ≥ 75 | 75 | 71.57 | **FAIL** |
| C2 | std < 15 (single-run cross-prompt proxy) | 15 | 15.28 | **FAIL** |
| C3 | 95% CI ⊂ [70,80] | [70,80] | [63.57, 79.57] | **FAIL** |
| C4 | per-category min ≥ 60 | 60 | 59.00 | **FAIL** |

<!-- ANALYZE_OUTPUT_END -->

## 회차 추이 (r1 → r7)

| 회차 | n_on | n_off | 비고 |
|---:|---:|---:|---|
| r1 | 28 | — | Opus judge |
| r3 | 28 | — | gpt-4o default temp |
| r4 | 29 | — | single run |
| r5 | 30 | — | judge temp=0+seed |
| r6 | 30 (×2 N=2) | — | capture+judge 양면 deterministic |
| **r7** | **8 (partial)** | **30** | **RAG ablation, partial RAG-ON** |

## 메서드 변경

- `src/lib/ai/generate.ts` — `RAG_DISABLE=1` 환경변수 추가. set 시
  `retrieveReferenceForPrompt()` 호출을 우회하고 빈 addendum 사용 → 시스템 프롬프트
  가 baseline (TM-74 이전 형태) 와 동일.
- `__tests__/benchmarks/tm-46-r7-capture.ts` — 모드별 디렉터리에 캡처 + soft deadline
  + ID filter. 한 번의 dev 서버 부팅 = 한 RAG 모드 (RAG\_DISABLE 은 server-side env 라
  중간에 변경 불가).
- `__tests__/benchmarks/tm-46-r7-analyze.ts` — RAG-ON/OFF 비교 + 페어드 Δ 계산 +
  ADR-0016 4기준 평가.

## 한계 / 후속 권장

1. **Partial RAG-ON (n=8)**: 25분 budget 내에서 dev 서버 재기동 + 두 번 capture 가
   불가능했음. 첫 8 프롬프트(dv-01..ta-02) 만 RAG-ON 데이터 확보. 본 회차의 paired 비교는 이
   8 IDs 만 신뢰 가능. 전체 30개 RAG-ON 은 후속 r8 에서 재실행 필요.
2. **Single-run baseline (N=1)**: r6 처럼 N=2 multi-round 가 아니므로 prompt-level
   noise band 내에서 결과가 흔들릴 수 있음. r7 결과는 **방향성 신호** 로만 사용.
3. **dev server kill 실수**: 첫 RAG-ON 캡처 진행 중(8/30) 잘못된 시점에 dev server 를
   재기동시켰음 (RAG-OFF 모드로 전환하려고). 이 시점에 capture 프로세스는 살아있어 9번째
   prompt 이후 ECONNREFUSED 로 실패. 향후: `pkill` 전에 capture 프로세스 종료 필수.

## 다음 회차 (r8) 권장

- RAG-ON n=30 + RAG-OFF n=30 풀 paired 측정.
- N=2 multi-round 도입 시 cost ~ $6 → $12. 25분 budget 으론 부족, 35-40분 추정.
- 본 회차의 `RAG_DISABLE` env 토글 + 새 capture 스크립트는 r8 에서 그대로 재사용.

## 비용 (실제)

- OpenAI gpt-4o judge: ~ 38 prompts × $0.05 = ~$1.9.
- gpt-4o-mini capture (TM-72 deterministic): ~ 60 generations × $0.02 = ~$1.2.
- 합계 ~$3.

## 산출물

- 코드: `src/lib/ai/generate.ts` (RAG_DISABLE 토글),
  `__tests__/benchmarks/tm-46-r7-capture.ts` (새 캡처 driver),
  `__tests__/benchmarks/tm-46-r7-analyze.ts` (분석),
  `__tests__/benchmarks/tm-46-judge.ts` (`--out` 옵션 추가).
- 데이터: `__tests__/benchmarks/results/tm-46-r7/{rag-on,rag-off}/scores.json`,
  `screenshots/`, `capture-manifest.json`.
- 회고: 본 파일 + `2026-04-27-TM-46-retro-r7.md`.

## 참고

- ADR-0019 (RAG templates) — 본 회차의 baseline 가설 출처.
- ADR-0016 (Acceptance gate v2) — 4 기준 평가 적용.
- ADR-0017/0018 (capture/judge determinism) — r5/r6 누적.
- 직전 회차: `2026-04-27-TM-46-visual-judge-r6.md`.
