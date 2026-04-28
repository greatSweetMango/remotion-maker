---
title: ADR-0016 — Visual quality acceptance gate v2 (4-criteria, multi-run)
created: 2026-04-27
updated: 2026-04-27
tags: [decision, ai, qa, llm-judge, acceptance-gate]
status: active
---

# ADR-0016: Visual quality acceptance gate v2 (4-criteria, multi-run)

## Status

Proposed (TM-73). 본 PR 머지 시 Active.
관련: [[0015-routing-streaming-pending|ADR-0015]], `0018-judge-determinism` (judge 결정성 정책 — TM-70).

## Context

TM-46 (Remotion 모션 그래픽 LLM-as-judge) 의 r1 ~ r5 회차 결과는 다음과 같다 (judge:
gpt-4o, N=1 호출, 30 templates, system prompt 동일):

| 회차 | 평균 (overall) | 비고 |
|------|----------------|------|
| r1   | 71.2           | 초기 baseline |
| r2   | 73.8           | minor prompt tweak |
| r3   | 71.2           | regression?  |
| r4   | 63.4           | "회귀" 알람 → TM-70 RCA spawn |
| r5   | 72.6           | TM-70 fix(temperature=0+seed) 적용 후 |

r5 까지 4 회차 연속 acceptance gate (단일 회차 평균 ≥ 75) 를 **MISS** 했다. 그러나 측정된
회차 간 std ≈ 8.1 점은 gate band (75 ± 5) 와 거의 같은 폭이라, **단일 회차 PASS/FAIL 신호의
신뢰도가 noise floor 안에 있다**. TM-70 RCA 가 이미 judge 호출 결정성 (temperature=0, seed=42,
N=3) 을 도입했지만, **회차 단위 acceptance 산식 자체** 가 단일 평균 1점 비교라 여전히 noise
에 취약하다.

즉 현재 gate 는 다음 두 가지 모드 실패에 노출:

1. **False FAIL** — 평균 74.9 인데 reject. 다음 회차 75.3 이면 accept. 무의미한 회차 반복.
2. **False PASS** — 평균 75.5 지만 한 카테고리 (예: typography) 가 50 점대 collapse. 표면적
   pass 지만 실제 사용자 체감 품질 미달.

## Decision

**acceptance gate 산식을 단일 평균 ≥75 → 4-criteria multi-run 합격제로 전환**.

회차 = N=3 회 동일 PNG 셋 + 동일 prompt + 동일 judge config 로 측정된 판정 trial. 한 회차의
overall 점수는 N=3 trial 의 평균이다 (TM-70 ADR 결정 그대로).

**한 acceptance window 는 회차 3 개 (= 9 trial 누적)** 로 정의하고, 다음 4 기준을 **모두**
통과할 때 PASS:

| # | 기준 | 산식 | 임계 |
|---|------|------|------|
| 1 | **mean** | window 내 3 회차 overall 평균의 평균 | ≥ 75 |
| 2 | **std**  | window 내 3 회차 overall 평균의 표준편차 (표본, n-1) | < 5 |
| 3 | **95% CI** | mean ± 1.96 · std/√3 의 양 끝이 [70, 80] 안 | both bounds ⊂ [70, 80] |
| 4 | **per-category min** | window 내 카테고리별 평균 (typography/composition/motion/color/timing) 최저값 | ≥ 60 |

4 기준 중 **하나라도 실패** 하면 acceptance 미충족 — 다음 둘 중 하나로 진행:

- **추가 회차 (rolling window)** — std 가 5 ~ 8 사이 borderline 이면 +1 회차 (총 4) 로 window
  rolling. 여전히 미통과 시 root cause 모드.
- **root cause 모드** — std ≥ 8 이거나 per-category min < 60 이면 즉시 RCA task spawn (judge
  variance, prompt regression, asset corruption 등 후보 조사).

### 측정 사례 (TM-46 r1 ~ r5 backfill)

`wiki/05-reports/` 의 r1 ~ r5 retro 데이터를 본 산식에 사후 적용한 결과:

- **window {r1, r2, r3}**: mean = 72.07, std = 1.50, 95% CI = [70.37, 73.77], per-category min
  추정 ≈ 64. → mean<75 **FAIL** (그러나 std/CI 는 narrow 라 noise 가 아님 — 실제 품질이
  75 미달).
- **window {r3, r4, r5}**: mean = 69.07, std = 4.95, 95% CI = [63.46, 74.67], per-category min
  추정 ≈ 52 (TM-46-r4 timing 카테고리 collapse). → mean<75 **FAIL**, per-category-min<60 **FAIL**.

**v1 gate (단일 회차 평균 ≥ 75)** 로는 r1~r5 모두 FAIL 만 떨어졌고, 어떤 회차에서 무엇이
문제인지 구분 불가. **v2 gate** 는 동일 데이터에서 (a) 평균 자체가 부족, (b) r4 timing
카테고리 collapse 두 모드 실패를 명확히 분리한다 — RCA 의 우선순위 결정에 직접 활용.

## Consequences

### 긍정
- **noise band 안의 false PASS/FAIL 제거** — 회차 std 가 측정되어 측정 신뢰도가 산식에 들어옴.
- **per-category collapse 즉시 가시화** — 한 카테고리만 무너지는 가짜 합격 차단.
- **rolling window** 로 회차 추가 비용은 +1 회 단위 (= 3 trial) 로만 늘어, 비용 폭발 없음.
- TM-70 ADR (judge 결정성) 과 직교: TM-70 은 trial 단위 noise, 본 ADR 은 회차 단위 noise 를
  다룬다.

### 부정
- **acceptance window = 3 회차** 이므로 완전 합격까지 최소 9 trial 필요. 회차 1 회 (~$1.5)
  기준 9 trial = 회차 3 = ~$4.5/window. v1 (회차 1 = ~$1.5) 대비 3배.
- per-category min 임계 60 은 현재 데이터로 calibrated — 새 카테고리 도입 시 임계 재조정 필요.

## Implementation Notes

- 산식 자체는 docs only — 본 ADR 으로 정책만 박제. 실제 evaluation harness 코드 (예
  `__tests__/benchmarks/tm-46-judge.ts` 의 acceptance 판정 블록) 갱신은 후속 task 에서 진행
  (별도 코드 PR).
- 회차 데이터 schema 갱신: `scores.json` 에 `runs: number[]`, `category_means: { [cat]: number }`
  필드 추가 — TM-70 ADR 의 per-sample variance 노출 결정과 동일 위치.
- acceptance window 결과는 `wiki/05-reports/<date>-TM-46-acceptance-window.md` 에 기록.

## See also

- [[0015-routing-streaming-pending|ADR-0015]] — 직전 ADR (라우팅/스트리밍).
- `0018-judge-determinism` — judge trial 단위 결정성 (본 ADR 의 전제).
- `wiki/05-reports/2026-04-27-TM-46-visual-judge-r5.md` — r5 raw 측정.
- `wiki/05-reports/2026-04-27-TM-70-rca.md` — judge variance RCA.
- `wiki/05-reports/2026-04-27-TM-73-retro.md` — 본 ADR 의 채택 회고.
