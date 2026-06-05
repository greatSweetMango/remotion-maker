---
title: "2026-06-05 — TM-189 refactor week 4: 테스트 커버리지 hot spot 보강"
created: 2026-06-05
updated: 2026-06-05
tags: [report, dev]
status: active
report_type: session
period: "2026-06-05"
author: "TeamLead (TM-189)"
provenance: extracted
---

# TM-189 — 테스트 커버리지 hot spot 보강 (refactor week 4)

## TL;DR

핵심 로직인데 미커버였던 4개 모듈(`ai/router`, `api/usage`, `api/lottie/manifest`, `ingest/url`의 네트워크 경로)에 mock 기반 테스트 25건 추가. 타깃 스코프 statements 커버리지 **85.64% → 86.8%**, 신규 테스트 전부 green, 기존 비회귀. 나머지 0% hot spot(evaluator/export/auth 등)은 import-time 환경 이슈 또는 충돌 회피 대상이라 follow-up task로 분리.

## 무엇이 바뀌었나

기능 코드 변경 없음(behavior-preserving). 테스트만 추가:

| 신규 테스트 파일 | 대상 모듈 | 커버리지 before → after | 케이스 |
|---|---|---|---|
| `__tests__/lib/ai/router.test.ts` | `src/lib/ai/router.ts` | 45.6% → **100%** | tier×complexity 라우팅 매트릭스, disableLLM opt 전달 |
| `__tests__/api/usage/route.test.ts` | `src/app/api/usage/route.ts` | 0% → **100%** | 401/404/200, TIER_LIMITS 파생, editUsage 파싱, owner scoping |
| `__tests__/api/lottie/manifest.test.ts` | `src/app/api/lottie/manifest/route.ts` | 0% → **100%** | picker shape, sha256 strip, cache-control, loader-throw 500 |
| `__tests__/ingest/url-fetch.test.ts` | `src/lib/ingest/url.ts` (fetchHtml/ingestUrl) | 66.1% → **98.9%** | content-type guard, !ok, size cap, timeout/abort, streamed vs buffered body, SSRF pre-fetch block |

- 모든 테스트는 mock 기반 (auth/prisma/fetch/classify 모킹) — LLM·실렌더·API 키·DB 불필요. 기존 컨벤션(`__tests__/api/trash/route.test.ts`, `__tests__/api/audio/manifest.test.ts`) 그대로 답습.

## 왜 / 배경

TM-94 자동 스케줄(refactor week 4). impact×effort로 우선순위화: "핵심 로직인데 미커버"가 1순위. 진짜 baseline을 얻기 위해 `collectCoverageFrom`을 명시(미import 파일은 기본적으로 instrument되지 않아 0%가 숨음)하여 타깃 스코프(`src/lib/**`, `src/app/api/**`, 충돌 파일 제외) 전수 측정.

- **러너 정정**: PM 노트는 vitest라 했으나 실제 러너는 **Jest** (`jest.config.js`, `next/jest`, v8 coverage provider). `--coverage`로 baseline 산출.
- **충돌 회피 준수**: TM-89/TM-187이 진행 중인 `pipeline.ts`/`generate.ts`/`asset-gen*.ts` 소스·테스트는 일절 건드리지 않음. 선정한 4개 모듈은 모두 충돌 스코프 밖.

### baseline 측정 결과 (충돌 파일 제외, 92개 타깃 파일)

- 전체: **85.64% stmts / 83.79% fns / 84.73% branches**
- 0% hot spot (impact 순): `remotion/evaluator.ts`(342 stmts), `generate/progress/route.ts`, `asset/[id]/share/route.ts`, `export/route.ts`, `lib/auth.ts`, `stripe/webhook`, `lib/remotion/bundle.ts`, `ai/edit.ts` 등.
- 부분 커버 hot spot: `ai/router.ts`(45.6%), `db/prisma.ts`(47.2%), `ai/stream.ts`(61.8%), `ingest/url.ts`(66.1%), `ai/classify.ts`(75.1%).

## 영향

- **코드/시스템**: 프로덕션 코드 변경 0. 테스트 25건 추가(전 green). 타깃 statements +1.16%p, 네 모듈 모두 사실상 100% 도달.
- **테스트 스위트**: 1402 → 1427 passing(+25), 기존 1건 실패(`player-playback-rate.test.tsx`, TM-99, pre-existing)는 변동 없음 — 비회귀 확인.
- **비용/성능**: mock-only, 추가 런타임 무시 가능(신규 4파일 ~0.6s).

### baseline에서 드러난 인프라 이슈 (follow-up 후보)

- `remotion/evaluator.ts`(0%, 342 stmts)는 가장 큰 단일 갭이지만, 기존 `evaluator.test.ts`/`evaluator-fuzz.test.ts`가 **import-time에 실패**한다: `evaluator.ts → CatalogueLottie.tsx → @remotion/lottie → lottie-web`가 node 테스트 환경에서 canvas(`fillStyle` on null)를 요구. 소스 수정은 충돌·behavior 위험이라 본 task 범위 외. → jsdom env 또는 lottie-web mock으로 별도 해결 필요.
- `package.json`의 jest `testMatch`가 비-테스트 파일(`*-entry.tsx` Remotion 번들 엔트리, `__tests__/**/*.mjs` 헬퍼, `plugin/**/test/*`, `__tests__/scripts/fixtures/**`)까지 포착 → 26개 "suite failed to run". 실제 실패 테스트는 1건뿐. testPathIgnorePatterns 정리로 노이즈 제거 가능.

## 후속 / 다음

- [ ] `evaluator.ts` import-time canvas 의존성 해소 후 evaluator 커버리지 복구 (lottie-web mock / jsdom) 📅 2026-06-12 — `TM-189-spawn-1`
- [ ] jest testMatch/testPathIgnorePatterns 정리(번들 엔트리·.mjs 헬퍼·fixtures 제외)로 26개 가짜 suite-fail 제거 📅 2026-06-12 — `TM-189-spawn-2`
- [ ] 다음 hot spot 라운드: `export/route.ts`, `stripe/webhook`, `lib/auth.ts` mock 테스트 (충돌 해제 후) 📅 2026-06-19 — `TM-189-spawn-3`

## 출처 / 링크

- 코드: `../../src/lib/ai/router.ts`, `../../src/app/api/usage/route.ts`, `../../src/app/api/lottie/manifest/route.ts`, `../../src/lib/ingest/url.ts`
- 테스트: `../../__tests__/lib/ai/router.test.ts` 외 3건
- status 반영: [[../02-dev/status]]
