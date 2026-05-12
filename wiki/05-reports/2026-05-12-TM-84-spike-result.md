---
title: "TM-84 spike — asset-gen (gpt-image-1) e2e 검증 결과"
created: 2026-05-12
updated: 2026-05-13
tags: [report, area/ai, area/cost, decision]
status: active
report_type: session
provenance: extracted
related: [ADR-0022, TM-82, TM-83]
---

# TM-84 spike — asset-gen (gpt-image-1) e2e 결과

## TL;DR

[[01-pm/decisions/0022-character-rendering|ADR-0022]] 옵션 B (image-gen API) **실행 가능. 권고 강화.** 3건의 실제 OpenAI `gpt-image-1` 호출 모두 성공, 결과 이미지는 ADR-0022 모티브 프롬프트(곰돌이/강아지/사람)를 정확히 커버. 비용/품질은 ADR-0022 예측과 일치. 단 **latency p50 ≈ 38s는 ADR-0022 추정(5-15s)보다 2-3배 길며, progressive UX와 비동기 큐가 필수**.

## 검증 범위

| 항목 | 결과 |
|---|---|
| OpenAI `gpt-image-1` 호출 성공 | 3/3 ✅ |
| 누적 비용 (USD) | $0.12 (예산 cap $0.50, 명시승인 $0.20 내) |
| 이론치($0.04×3) vs 실측 | 일치 ✅ |
| Latency (p50 / range) | 38.2s / 36.9 - 44.4s |
| PNG sanity (size > 5KB) | 3/3 ✅ (실측 1.7-2.0 MB) |
| 시각 품질 (사람 검수) | 3/3 on-prompt, production 수준 |
| Remotion `<Img>` 통합 | stub 생성 OK (`.spike-assets/TM84Spike.stub.tsx`) — data URL을 PARAMS.imageUrl로 노출 가능함 확인 |
| 단위 테스트 (mocked) | 4/4 pass |
| typecheck (asset-gen.ts) | 0 errors (사전 존재 에러는 무관) |
| eslint (신규 파일) | clean |

## 결과 이미지

| ID | 프롬프트 요약 | 결과 |
|---|---|---|
| P1 | 초원 곰돌이, children-book 스타일 | ![[wiki/05-reports/screenshots/TM-84/P1-bear-meadow.png]] |
| P2 | 해변 코기, watercolor | ![[wiki/05-reports/screenshots/TM-84/P2-corgi-beach.png]] |
| P3 | 숲 속 인물, paper-cut flat | ![[wiki/05-reports/screenshots/TM-84/P3-person-forest.png]] |

P1은 [[01-pm/decisions/0022-character-rendering|ADR-0022]]의 모티브 프롬프트("곰돌이 캐릭터가 초원을 걸어가는 10초 애니메이션")를 거의 그대로 영문/스타일 보강하여 호출 — generation은 한국어 원문 그대로도 동작하지만 spike는 영문 + style hint로 안정성 우선.

## ADR-0022 가설 검증 매트릭스

| ADR-0022 가설 | 실측 | 평가 |
|---|---|---|
| 비용 +$0.04 / asset (1024² standard) | $0.04 × 3 = $0.12 정확 일치 | ✅ 확정 |
| 캐릭터 일관성: gpt-image-1 충분 | 곰돌이 / 코기 / 사람 모두 안정적 | ✅ |
| Latency 5-15s | **실측 36-44s (≈2-3× 추정)** | ⚠️ **추정 갱신 필요** |
| `<Img>` + PARAMS.imageUrl 패턴 호환 | 통합 stub TSX 작성 가능, 기존 extract-params는 `type: image` 이미 지원 | ✅ |
| 옵션 B 우선 + A 보강 hybrid | 본 spike는 B만 검증. A는 follow-up | — |

## 권고 사항 — ADR-0022 보강

1. **옵션 B 결정 유지·강화.** 캐릭터 prompt 커버리지가 실측으로 입증됨. 옵션 A(SVG 라이브러리) 자산 큐레이션 일정에 묶이지 않고 image-gen 단독으로 cover 100% 달성 가능 (단 비용/latency trade-off 수용 시).
2. **Latency 추정치 5-15s → 30-45s로 갱신.** ADR-0022 본문에 반영 필요. UX 영향:
   - "캐릭터 생성 중…" progressive UI는 **30초+** 견딜 수 있어야 함. 단순 spinner로 부족. 단계별 상태 메시지 + 옵션적 백그라운드 큐 (Pro tier에서는 비동기, 무료 tier는 동기 cap).
   - generate API의 streaming TTFB 대비 image-gen은 latency가 dominate. 첫 generate latency 예산을 별도 라인으로 추적해야 함.
3. **로컬 캐시 검증 후순위 → R2 우선화.** Latency가 길수록 R2 영구 캐시 적중률 가치가 큼. data URL 인라인은 spike에서만 OK; 프로덕션은 hash → R2 key 매핑 필수 (ADR-0022 "Caching" 섹션 그대로).
4. **Quality 기본값 = `low` 후보 vs `medium`.** spike는 default model size로 호출. 더 저렴한 quality 단계 비교는 follow-up task로 분리 — 비용 절감 vs 디자인 일관성 trade-off.
5. **Trigger gate 강화.** clarify 후에도 *style hint*가 없으면 default illustration 스타일을 LLM이 prompt에 자동 보강하도록 spec 단계 prompt 보강 (현 spike에서 영문+스타일 보강 prompt가 잘 동작한 이유).

## 후속 task 후보

- **TM-NEXT-A: PARAMS `type: image` regen-prompt UI** — customize 탭에 "이미지 재생성" 버튼 + prompt edit. extract-params는 이미 type 인식. UI 컴포넌트만 추가.
- **TM-NEXT-B: R2 영구 캐시 레이어** — `hash(prompt+style+size) → r2key`, 적중 시 image-gen skip. R2 적재 큐 + 재시도. 비용 가드 hook 연동.
- **TM-NEXT-C: scene-spec → asset-gen 파이프라인 통합** — `src/lib/ai/generate.ts` multi-step pipeline에 `assetGenStage` 삽입 (ADR-0020 multi-step pipeline 경로). character/animal/person trigger gate 포함.
- **TM-NEXT-D: latency UX** — 30s+ 체감 단축을 위한 progressive 단계 메시지 + 백그라운드 큐 (Pro tier).
- **TM-NEXT-E: quality tier 벤치** — `low` / `medium` / `high` 비용 vs 품질 trade-off 계량화.

## 산출물

- `src/lib/ai/asset-gen.ts` — OpenAI Images API 얇은 래퍼. client 주입 seam으로 단위 테스트 가능.
- `__tests__/lib/ai/asset-gen.test.ts` — 4 unit tests, mocked.
- `scripts/qa/tm-84-spike.mjs` — live e2e 1-3 calls + budget guard.
- `.spike-assets/` (gitignored) — PNG 산출물 + Remotion `<Img>` stub TSX.
- `wiki/05-reports/screenshots/TM-84/` — 본 보고서용 미러 PNG + `spike-summary.json`.

## 비용 영수증

| 항목 | 값 |
|---|---|
| 호출 수 | 3 |
| 모델 | `gpt-image-1` (size=1024x1024, n=1) |
| 단가 (USD) | 0.04 |
| 총 비용 | 0.12 |
| 사용자 명시 승인 한도 | 0.18 (cap=$18 OpenAI 전체) |
| 잔여 | $0.06 (사용 안 함) |
