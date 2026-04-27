---
title: "Experiment Report — TM-33 모델 라우팅 + Streaming"
date: 2026-04-27
type: experiment
task: TM-33
status: implementation-complete-validation-pending
tags: [report, experiment, perf, ai-routing]
---

# TM-33 — 생성 속도 5초→2초 실험

## TL;DR
라우팅(heuristic + Haiku tie-break) + streaming 파이프라인 구현 완료. **207/207 tests** 통과. **검증 단계 PENDING** — 워크트리 환경에 ANTHROPIC_API_KEY 부재로 first-frame-time과 품질 측정 불가.

## 가설
> 단순 프롬프트는 Haiku로 라우팅, complex는 Sonnet streaming, 첫 프레임 < 2s 가능.

## 산출물
- `src/lib/ai/classify.ts` — heuristic + Haiku tie-breaker
- `src/lib/ai/stream.ts` — streaming + progressive parser
- `src/lib/ai/router.ts` — `routePrompt(prompt, tier)`
- `__tests__/benchmarks/tm-33-routing.benchmark.ts` — 50 프롬프트 라벨 + 측정 드라이버
- `__tests__/lib/ai/classify.test.ts` — 10 테스트
- ADR-0015 (PENDING)

## 측정 (오프라인, heuristic만)

| 항목 | 값 | 목표 |
|---|---|---|
| Heuristic coverage | 45/50 | — |
| Resolved accuracy | **88.9%** | ≥85% |
| Ambiguous → Haiku | 5/50 | — |

misclassifications: 5건 (4 false-complex + 1 false-simple)

## 검증 PENDING

라이브 실행 필요:
```bash
ANTHROPIC_API_KEY=… npx tsx __tests__/benchmarks/tm-33-routing.benchmark.ts > tm-33-live.json
```
예상 비용: ~$1.05

## 머지 안전성
**API 라우트 미수정 (additive only)** — 머지해도 동작 변화 0. 라이브 검증 후 별도 task로 wire-in.

## 다음 액션
1. 머지 (additive 코드, 안전)
2. 별도 task TM-38 큐잉: 라이브 측정 + ADR-0015 promote/reject 결정
3. 채택 시 wire-in task 별도 생성 — `/api/generate`에 router 호출
