---
title: ADR-0018 — Visual judge 결정성 정책 (temperature=0 + seed + N-shot)
created: 2026-04-27
updated: 2026-04-27
tags: [decision, ai, qa, llm-judge]
status: active
---

# ADR-0018: Visual judge 결정성 정책

## Status

Proposed (TM-70 RCA 산출). 본 PR 머지 시 Active.

## Context

TM-46 (Remotion 모션 그래픽 LLM-as-judge) 의 r3 (avg 71.2) → r4 (avg 63.4) -7.8 "회귀"는
TM-70 의 root-cause 실험 결과 **judge 비결정성에 의한 측정 노이즈** 로 결론지었다.

실험 (`__tests__/benchmarks/tm-70-judge-variance.ts`):
- 동일한 5 sample × 동일 PNG bytes × 동일 system prompt 로 OpenAI gpt-4o 를 3회 호출 (현재 설정).
- 결과: 샘플 단위 Δmax **평균 10.4 점 / 최대 17 점** (`ta-02-proxy` 61~78).
- 동일 호출에 `temperature: 0, seed: 42` 적용 시 Δmax **평균 1.4 점 / 최대 3 점**.

즉 "전체 평균 회차차 -7.8" 은 단일 샘플 noise 보다 작아, 회귀라 단정할 수 없다.

이는 acceptance gate (≥75) 와 자동 follow-up spawn (overall < 70) 둘 다 false positive/negative
에 흔들리게 만든다.

## Decision

1. **judge 호출 결정성** — `tm-46-judge.ts` 의 OpenAI Chat Completions 호출에 다음을 강제:
   - `temperature: 0`
   - `seed: 42` (고정 정수, 변경 시 ADR amend)
   - `response_format: { type: 'json_object' }` (기존 유지)

2. **acceptance gate 산식 변경** — 단일 회차 평균 대신:
   - 옵션 A (저비용): 동일 PNG 셋에 대해 judge 를 **N=3 호출** → 샘플 overall 의 평균을 사용.
   - 옵션 B (고비용): 다른 가족 모델 1개 (예: claude-sonnet) 까지 N=2 호출 → 평균.
   - 본 ADR 은 **옵션 A 를 default** 로 채택. judge 비용 ~3배 (~$1.5/회차) 이지만 변동 측정의
     SE 가 √3 만큼 줄어 의사결정 신뢰도 향상.

3. **회차 간 비교** — Δavg < 10 점인 변화는 "noise band 내" 로 분류, 회귀/개선 결론 금지.
   카테고리 단위 비교는 카테고리 내 sample n=6 이라 신뢰도가 더 낮으므로 Δavg < 15 점에서만
   회귀/개선 라벨 부여.

4. **per-sample variance 노출** — `scores.json` 에 `runs: number[]`, `delta_max`, `std` 필드를
   추가하여 spawn 결정과 PR 보고서에서 noise 큰 샘플을 구분 가능하도록 한다.

## Consequences

### 긍정
- 동일 입력의 score 가 ±2 점 이내로 안정 → 회차 간 fix 효과 측정 가능.
- 자동 follow-up task spawn 의 false positive 감소.
- 향후 다른 LLM-as-judge (text-quality, prompt-routing) 패턴에도 그대로 재사용.

### 부정
- N=3 호출 채택 시 비용 ~3배 (~$1.5/회차).
- `seed` 는 OpenAI 의 best-effort (`system_fingerprint` 변경 시 결과 다를 수 있음). 완전한
  결정성을 보장하지 않으나 default 보다 압도적으로 안정.

### 마이그레이션
- 본 PR (TM-70) 에서 `tm-46-judge.ts` config 변경 + 실험 코드 박제.
- 다음 iter 의 TM-46 r5 가 N=3 평균 acceptance 를 적용한 첫 회차가 될 것.

## Alternatives considered

- **변경 없음**: 단일 호출 + temperature=1 유지. 현 상태. 회귀 판정이 noise 기반이라 의사결정
  악화 누적. **기각**.
- **temperature=0 만 적용 (seed 미사용)**: 대부분 결정적이지만 OpenAI는 여전히 미세 drift 가능.
  cost 차이는 0 이므로 seed 도 함께 적용하지 않을 이유 없음. **흡수**.
- **judge 모델 교체 (gpt-4o → claude-opus 4.7 multimodal)**: TM-66 가 ANTHROPIC_API_KEY 부재로
  OpenAI 로 마이그레이션한 직후 다시 변경 시 비용/스토리 부담. variance 자체가 모델 공통 문제이므로
  결정성 정책이 우선. **보류** (별도 ADR 후보).

## See also

- [TM-70 RCA 보고서](../../05-reports/2026-04-27-TM-70-rca.md)
- [TM-46 r3](../../05-reports/2026-04-27-TM-46-visual-judge-r3.md) / [r4](../../05-reports/2026-04-27-TM-46-visual-judge-r4.md)
- 코드: `__tests__/benchmarks/tm-46-judge.ts`, `__tests__/benchmarks/tm-70-judge-variance.ts`
