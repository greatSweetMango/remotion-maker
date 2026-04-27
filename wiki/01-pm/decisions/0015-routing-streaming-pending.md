---
title: "ADR-0015: Model routing + streaming for generate path (PENDING validation)"
status: pending-validation
date: 2026-04-27
tags: [decision, perf, ai-routing, streaming, experiment]
task: TM-33
---

# ADR-0015: Model routing + streaming for generate path

## Status
**PENDING — implementation merged, hypothesis validation deferred**.

코드는 머지됐으나 `/api/generate`에 wire 되지 않음. ANTHROPIC_API_KEY를 사용한 라이브 측정으로 first-frame-time < 2s + 품질 ≥ 90% baseline 충족 시 promote, 미충족 시 reject 후 wire 제거.

## Context
`POST /api/generate`는 단일 blocking Anthropic 호출 (Sonnet PRO / Haiku FREE). 중앙값 ~5s, 전체 응답 후 사용자에게 표시. < 2s first-frame이 "instant" 임계.

가설: 단순 프롬프트 → Haiku ~1s 직접 처리, complex → Sonnet streaming → 첫 토큰 < 2s.

## Decision

**Classifier → Router → (direct | streaming)** 파이프라인 (additive only, route 미수정):

1. **`src/lib/ai/classify.ts`** — 2-tier:
   - Heuristic (free, ~0ms): word/sentence count, list markers, scene words (장면|순차|...), complex nouns (timeline|graph|...), Korean count markers (3가지, 5개), enumerated English (4 boxes)
   - Haiku tie-breaker (max_tokens=4, simple/complex 단일 토큰 강제) for ambiguous middle. parse 실패/no key → fallback `complex` (안전 느린 경로)

2. **`src/lib/ai/router.ts`** — `routePrompt(prompt, tier) → {model, streaming, complexity, classifier}`
   - simple → Haiku, non-streaming
   - complex → tier model, streaming

3. **`src/lib/ai/stream.ts`** — `streamComplete()` Anthropic messages.stream wrapper. `firstTokenMs`, `onDelta(chunk, sofar)`, `parseProgressive(text)` for top-level scalar fields (title/mode/fps/width/height) flush before code completes.

4. **`__tests__/benchmarks/tm-33-routing.benchmark.ts`** — 50-prompt 라벨 + measureRouting (live) + dryRunHeuristic (offline).

ADR-0003 cache_control 보존 — 시스템 프롬프트 무수정.

## Why two-tier (heuristic + Haiku)
- 매 요청 Haiku 분류기는 ~$0.0001/req + ~150-300ms p50 추가 (regex가 100% 맞아도)
- 순수 heuristic은 빠르지만 false-positive/negative 있음 (TM-3 set 측정)
- Heuristic 신뢰 boundary에서 split: regex의 속도 + LLM의 정확도 (10% 모호 케이스)

## Measurement (offline, heuristic-only)
| Metric | Value | Target |
|---|---|---|
| Heuristic coverage | 45/50 | — |
| Resolved accuracy | **88.9%** | ≥85% |
| Ambiguous → Haiku | 5/50 | — |

Misclassifications:
- complex 오분류 4건 (`dv-04, dv-09, ld-01, ld-03`) — 일반 명사 graph/loader/chart. 느린 경로지만 품질 무손실
- simple 오분류 1건 (`ig-09`) — 단일 문장 다요소. 품질 약손실 가능

## Validation PENDING

- [ ] first-frame-time < 2s (50 평균) — 라이브 API 필요
- [ ] 품질 ≥ 90% baseline — TM-3 재실행 필요
- [x] 분류기 ≥ 85% — heuristic만 88.9%

라이브 실행:
```bash
ANTHROPIC_API_KEY=… npx tsx __tests__/benchmarks/tm-33-routing.benchmark.ts > tm-33-live.json
# 예상 비용: ~$1.05
```

## Promote / Reject 게이트

- ✅ first-frame < 2s + 품질 ≥ 90% → status=accepted, /api/generate에 router wire-in (별도 task)
- ❌ 한 항목 실패 → status=rejected, ADR에 사유 박제, 코드 deprecate (router 자체는 유용 → 미래 재시도)
