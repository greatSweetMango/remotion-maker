---
title: "ADR-0014: Sandbox evaluator 보안/속도 강화 (LRU + deny list + CSP)"
status: accepted
date: 2026-04-27
tags: [decision, security, perf, sandbox]
---

# ADR-0014: Sandbox evaluator hardening

## Context
TM-34 — sucrase 기반 evaluator의 보안/메모리/속도 강화. iframe/Worker 격리 검토.

## Decision (defense-in-depth)

### 1. Evaluator (`src/lib/remotion/evaluator.ts`)
- FNV-1a 해시 LRU 캐시 (cap 64)
- collision-safe via stored `code.length`
- 5s factory-construction timeout
- `__evaluatorCacheSize` / `__evaluatorCacheConfig` 노출 (테스트용)

### 2. Sandbox deny list (`src/lib/remotion/sandbox.ts`)
~15 신규 패턴: `new Function`, `setTimeout(string)`, `WebSocket`, `EventSource`, `sendBeacon`, `indexedDB`, `caches`, `__defineGetter__/__defineSetter__`, `with(`, `arguments.callee`, `Worker/SharedWorker/ServiceWorker`, `location.assign|replace|href`. 중복 토큰 dedup.

### 3. CSP (`next.config.ts`)
- `default-src 'self'`, narrowed `connect-src`
- `frame-ancestors 'none'`, `object-src 'none'`
- `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`
- `Referrer-Policy strict-origin-when-cross-origin`
- `'unsafe-eval'` 유지 — 구조적 (Remotion sucrase 평가)

## Rejected with rationale

- **Worker / iframe isolation**: Remotion 컴포넌트는 host React tree 안에서 렌더 필수. cross-realm 경계 시 functions structured-cloneable 아님 + `useCurrentFrame` host fiber context 의존. **Pre-flight Worker** (LLM 출력 게이트의 validateCode + transpileTSX) 후행 권장.
- **Heap quota**: host realm에서 구현 불가. "memory limit"은 bounded LRU로 해석.

## Verification
- jest 160/160 (+44 신규), tsc/eslint clean
- 새 `evaluator.test.ts`: 25/25 템플릿 회귀 통과
- PARAMS-vs-component regex bug (tech-note 2026-04-26-evaluator-params-bug) 전용 test

## Follow-up (별도 task 후보)
- Pre-flight Worker for `validateCode + transpileTSX`
- 실시간 heap usage telemetry
- CSP report-uri 엔드포인트
