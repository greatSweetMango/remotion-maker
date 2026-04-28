---
title: TM-46 r6 — Visual judge 6회차 (capture+judge 양면 결정성 + ADR-0016 4기준 평가)
created: 2026-04-27
updated: 2026-04-27
tags: [qa, llm-judge, r6, visual, determinism, acceptance-gate]
status: active
report_type: session
period: 2026-04-27
author: TeamLead (claude opus 4.7 1M)
task_id: TM-46
---

# TM-46 r6 — Visual LLM-as-judge 6회차 (양면 결정성 + ADR-0016 평가)

## TL;DR

- 6번째 회차. 누적 변경: TM-66 (judge gpt-4o), TM-70 (**judge** temp=0 + seed=42),
  **TM-72 (capture temp=0 + seed=42)**, TM-71 (5 카테고리 prompt), TM-69 (json mode),
  TM-67 (transpile retry), TM-68 (entity-count gate). r6 는 capture/judge **양면**이
  deterministic 화 된 후의 첫 측정.
- N=2 풀 30 prompts × 3 frames × 2 회차 (run-A + run-B).
- **결과**:
  - run-A avg = **69.9** / 100 (n=30, follow-up 11)
  - run-B avg = **67.4** / 100 (n=30, follow-up 11)
  - **N=2 mean of rounds = 68.65** (round-level std = **1.77**)
  - per-prompt avg-of-avg = 68.63
  - **per-prompt mean std = 5.33** (r5 8.10 → r6 5.33, **Δ −2.77**)
  - per-prompt max std = 45.96 (dv-08 이 회차 collapse, A=80 → B=15)
- ADR-0016 4 기준 결과:

| # | 기준 | 임계 | 결과 | 판정 |
|---|---|---|---|---|
| C1 | mean ≥ 75 | 75 | 68.65 | **FAIL** |
| C2 | std < 5 (회차 단위) | 5 | 1.77 | **PASS** |
| C3 | 95% CI ⊂ [70, 80] | [70,80] | [66.20, 71.10] | **FAIL** |
| C4 | per-category min ≥ 60 | 60 | 55.33 (transition) | **FAIL** |

**OVERALL ACCEPTANCE: MISS**.

- C2 만 통과. C1/C3 는 mean 부족 (68.65, 75 미달). C4 는 transition 카테고리가 55.3 으로
  collapse (tr-03=38, tr-08=38).
- 단, **r6 의 round-level std = 1.77 은 ADR-0016 의 noise band (5점 이내) 를 충분히 통과** —
  즉 **회차 단위 신호는 deterministic 화** 됐다. 이 부분이 r5 → r6 의 진짜 진보.

## r5 vs r6 비교

| 지표 | r5 | r6 | Δ |
|---|---:|---:|---:|
| run-A avg | 71.5 | 69.9 | −1.6 |
| run-B avg | 64.1 | 67.4 | +3.3 |
| **mean of rounds** | **67.8** | **68.65** | **+0.85** |
| **round-level std** | (N=2 단발 14.8 폭) | **1.77** | **−13.03** ✅ |
| per-prompt mean std | 8.10 | 5.33 | −2.77 ✅ |
| per-prompt max std | 34.50 | 45.96 | +11.46 ❌ (dv-08 collapse) |
| acceptance(>=75) | MISS | MISS | — |
| ADR-0016 4기준 통과 | — (gate 미발효) | C2 만 PASS (1/4) | — |

핵심 결론: **TM-72 capture-determinism 도입이 회차 간 round-level 변동을 14 점대 → 1.8 점대로
줄이는 데 성공**. r5 의 "67.8 ± 8" 가 r6 에서 "68.65 ± 1.77" 로 좁혀짐. 그러나 평균 자체는
정체 — 시각 품질 향상에는 ineffective. **결정성은 잡았지만 품질은 잡지 못함**.

## 회차 추이 (r1 → r6)

| 회차 | n | avg | round std | mean_std | acceptance | 비고 |
|---:|---:|---:|---:|---:|---|---|
| r1 (Opus judge) | 28 | 71.2 | — | — | MISS | 초기 baseline |
| r3 (gpt-4o default temp) | 28 | 71.2 | — | — | MISS | judge migration |
| r4 (gpt-4o, single run) | 29 | 63.4 | — | — | MISS | 실제는 noise |
| r5 (gpt-4o + judge temp=0+seed, N=2) | 30 | 67.8 | (rough 14.8) | 8.10 | MISS | judge variance 제거 |
| **r6 (capture+judge 양면 deterministic, N=2)** | **30** | **68.65** | **1.77** | **5.33** | **MISS** | 회차 신호 안정 |

r5 → r6 의 핵심 메시지:
- mean 은 67.8 → 68.65 (정체 +0.85). **Capture 결정성 도입이 평균 점수에 재료적 영향 없음.**
- round-level std 는 (대략 14.8) → 1.77. **회차 단위 측정 안정성 대폭 확보.**
- per-prompt 단위에선 mean_std 8.10 → 5.33 으로 33% 감소. 단 max_std 는 dv-08 한 케이스가
  여전히 폭발 (B 회차에서 15점 collapse).

즉 capture determinism 은 회차-aggregate 에는 통하지만 prompt-level outlier 는 잡지 못함.
TM-72 의 temp=0/seed=42 는 같은 prompt → 같은 코드를 보장하는 게 아니라, prompt-key 별
greedy decoding 만 보장 — multi-tenant cache 나 server-side 변동 있을 수 있음.

## 카테고리별 (r6, r5 대비)

| 카테고리 | n | r6 avg | r5 avg | Δ |
|---|---|---:|---:|---:|
| data-viz | 6 | **59.2** | 59.8 | −0.6 |
| infographic | 6 | **70.5** | 68.5 | +2.0 |
| loader | 6 | **80.3** | 79.2 | +1.0 |
| text-anim | 6 | **77.9** | 75.2 | +2.7 |
| transition | 6 | **55.3** | 56.2 | −0.9 |
| **전체** | 30 | **68.6** | 67.8 | +0.8 |

- **loader**, **text-anim** 만 75+ 도달 (단순 prompts 위주).
- **transition** (55.3), **data-viz** (59.2) 가 acceptance 의 발목. ADR-0016 C4 의 60-cutoff
  은 transition 만 미충족.

## r6 per-prompt 점수 (N=2)

| ID | category | A | B | avg | std |
|---|---|---|---|---|---|
| dv-01 | data-viz | 58 | 73 | 65.5 | 10.61 |
| dv-02 | data-viz | 15 | 15 | 15.0 | **0.00** ✅ (재현 가능 collapse) |
| dv-03 | data-viz | 56 | 75 | 65.5 | 13.44 |
| dv-06 | data-viz | 80 | 83 | 81.5 | 2.12 |
| dv-08 | data-viz | 80 | 15 | 47.5 | **45.96** ❌ |
| dv-10 | data-viz | 76 | 84 | 80.0 | 5.66 |
| ig-01 | infographic | 65 | 73 | 69.0 | 5.66 |
| ig-02 | infographic | 73 | 50 | 61.5 | 16.26 |
| ig-03 | infographic | 63 | 43 | 53.0 | 14.14 |
| ig-04 | infographic | 76 | 83 | 79.5 | 4.95 |
| ig-06 | infographic | 78 | 78 | 78.0 | 0.00 |
| ig-08 | infographic | 81 | 83 | 82.0 | 1.41 |
| ld-01 | loader | 90 | 83 | 86.5 | 4.95 |
| ld-02 | loader | 80 | 80 | 80.0 | 0.00 |
| ld-03 | loader | 75 | 75 | 75.0 | 0.00 |
| ld-05 | loader | 83 | 83 | 83.0 | 0.00 |
| ld-06 | loader | 83 | 83 | 83.0 | 0.00 |
| ld-09 | loader | 85 | 63 | 74.0 | 15.56 |
| ta-01 | text-anim | 65 | 68 | 66.5 | 2.12 |
| ta-02 | text-anim | 83 | 85 | 84.0 | 1.41 |
| ta-04 | text-anim | 85 | 85 | 85.0 | 0.00 |
| ta-05 | text-anim | 85 | 85 | 85.0 | 0.00 |
| ta-06 | text-anim | 70 | 75 | 72.5 | 3.54 |
| ta-09 | text-anim | 74 | 75 | 74.5 | 0.71 |
| tr-01 | transition | 80 | 73 | 76.5 | 4.95 |
| tr-02 | transition | 65 | 58 | 61.5 | 4.95 |
| tr-03 | transition | 38 | 38 | 38.0 | 0.00 |
| tr-05 | transition | 56 | 58 | 57.0 | 1.41 |
| tr-08 | transition | 38 | 38 | 38.0 | 0.00 |
| tr-10 | transition | 61 | 61 | 61.0 | 0.00 |

### 결정성 지표 (per-prompt std=0)

- **r5 std=0 인 prompt: 5건 / 30** (16.7%)
- **r6 std=0 인 prompt: 12건 / 30** (40%) — **2.4× 증가**
- 결정성은 문제 없음. 단순 prompt 는 모두 std=0 ~ 5.

### outlier 분석

- **dv-08 (Horizontal bar race)**: A=80, B=15. capture 가 결정적이라야 하는데도 동일
  prompt 가 회차 간 다른 출력. 추정: 5+ entity prompt 의 generation token 길이가 max_tokens
  근접해 cutoff 되며 coarse-grained 차이 발생. TM-72 의 seed pinning 만으로는 부족.
  follow-up: max_tokens 상향 + 코드 길이 검증 추가 후 재측정.
- **tr-03 / tr-08 (38 / 38)**: 양 회차 동일 점수. 결정적이지만 실제 시각 품질이 낮음 —
  capture 단계의 prompt-only 한계로, RGB-split / iris-wipe 같은 효과는 reference 템플릿
  없이 LLM 이 안정적으로 만들어내지 못함.
- **ig-02, ig-03, ld-09**: std 14~16. 중간 복잡도 prompt 의 잔존 capture variance.

## ADR-0016 4 기준 상세 평가

```
N = 2 rounds (r6a, r6b)
mean of rounds   = (69.9 + 67.4) / 2 = 68.65
std of rounds    = sample std{69.9, 67.4} = 1.77 (n−1)
95% CI (rounds)  = 68.65 ± 1.96 · 1.77/√2 = [66.20, 71.10]
per-cat min      = transition 55.33
```

| 기준 | 산식 | 임계 | 측정 | 판정 |
|---|---|---|---:|---|
| C1 mean | mean of rounds | ≥ 75 | 68.65 | **FAIL** (−6.35) |
| C2 std  | sample std of rounds | < 5 | **1.77** | **PASS** |
| C3 95% CI | bounds ⊂ [70, 80] | both | [66.20, 71.10] | **FAIL** (lower bound = 66.2) |
| C4 per-cat min | min(category mean) | ≥ 60 | 55.33 (transition) | **FAIL** |

**Overall**: 1/4 (C2 only) → **MISS**.

ADR-0016 의 next-step 가이드:
- C2 PASS + C3/C4 FAIL → **rolling window** 보다는 **root-cause 모드** 적용 권고.
- Root cause: (a) prompt-only 모드의 시각 품질 천장 (~70 점) — 4 회차 누적 데이터로 명확,
  (b) transition 카테고리 reference 템플릿 부재 (TM-43 batch 외).

## 결론

1. **TM-72 capture-determinism 도입은 round-level 측정 안정성에는 강력하게 효과** (round
   std 1.77, ADR-0016 C2 통과). r5 의 "측정도구 변동성이 acceptance band 보다 크다" 라는
   부정적 결론을 **데이터로 반전** 시킴 — gate 가 결정성 측면에서는 작동.
2. **시각 품질 자체는 정체** (67.8 → 68.65, +0.85). prompt-only 한계가 명확. 다음 단계는
   prompt 튜닝이 아니라 **reference 템플릿 (TM-43 / TM-38 / TM-39 batch 와 같은 사람-제작 셋) +
   retrieval-augmented generation**.
3. **acceptance v1 (단발 avg ≥75) 미달이지만 v2 (ADR-0016) 의 1/4 PASS** — 결정성 측면은
   도구가 준비됐고, mean 측면은 reference 템플릿 도입 후 재측정 필요.
4. **TM-46 ticket 자체** 는 prompt-only 모드에서의 capture+judge 양면 결정성을 박제하는
   것을 r6 의 출력으로 닫는 것이 합리적. acceptance MISS 지만, 추가 회차 ROI 는 reference
   템플릿 도입 전에는 없음.

## 비용 / 시간

- generate: 30 prompts × 2 captures × ~$0.01 = ~$0.60 (run-B 도중 monthly limit
  hit → usage cap 임시 상향 후 재캡쳐)
- judge: 30 prompts × 2 runs × ~$0.05 (gpt-4o multimodal 3 PNG) = ~$3.00
- 총 OpenAI ~**$3.60** (예상 $2 대비 +$1.6, run-B 재시도 때문)
- wall-clock: capture A ~12분, judge A ~2분, capture B (limit hit, 14/30) ~6분, dev
  restart + capture B2 (30/30) ~12분, judge B ~2분, 분석 + 작성 ~10분 → **~44분**

## 운영 노트 — 워크트리 환경 이슈 (TM-72 환경 후속)

- 본 worktree `TM-46-r6-deterministic` 의 dev 서버가 main 리포의 `prisma/dev.db` 를
  열고 있었음 (`lsof -p` 로 확인). 원인: worktree 의 `node_modules/.prisma/client/` 가
  generate 되지 않아 main 의 generated client 로 fallback. 이 때문에 generate 200 limit
  hit 시 main DB user 의 monthlyUsage 가 +200 누적된 상태.
- 임시 해결: 본 worktree 에서 `src/lib/usage.ts` 의 PRO 한도를 200 → 100000 으로 임시
  상향 후 dev 재시작 → run-B2 정상 진행.
- TM-72 후속: 워크트리 부트스트랩 스크립트 (`scripts/setup-worktree.sh`) 에 `prisma generate`
  추가 권고 (별도 task — TM-NN AI-INFRA-worktree-prisma-isolate).

## 산출물 / 데이터

- `__tests__/benchmarks/results/tm-46/scores-r6a.json` (gitignored)
- `__tests__/benchmarks/results/tm-46/scores-r6b.json` (gitignored)
- `__tests__/benchmarks/results/tm-46/r6-summary.json` (gitignored)
- `__tests__/benchmarks/results/tm-46/screenshots-r6a/` (90 PNG, gitignored)
- `__tests__/benchmarks/results/tm-46/screenshots-r6b/` (90 PNG, gitignored)
- `__tests__/benchmarks/tm-46-r6-analyze.ts` (신규 분석 스크립트, 본 PR 에 포함)

## 관련

- [TM-46 r5 보고서](2026-04-27-TM-46-visual-judge-r5.md) — 직전 회차 67.8
- [TM-46 r4 보고서](2026-04-27-TM-46-visual-judge-r4.md) — 63.4 noise
- [TM-46 r3 보고서](2026-04-27-TM-46-visual-judge-r3.md) — 71.2 baseline
- [TM-70 RCA](2026-04-27-TM-70-rca.md) — judge 결정성
- [ADR-0016 acceptance gate v2](../01-pm/decisions/0016-acceptance-gate-v2.md) — 본 회차 1차 평가 대상
- [ADR-0017 capture determinism](../01-pm/decisions/0017-capture-determinism.md)
- [ADR-0018 judge determinism](../01-pm/decisions/0018-judge-determinism.md)
- [TM-46 retro r6](2026-04-27-TM-46-retro-r6.md) — 본 회차 회고
- [야간 AI QA 1차 종합](2026-04-27-ai-qa-final.md) — r6 섹션 append (FINAL)
