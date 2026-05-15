---
title: "TM-149 — post-TM-135 stack 통합 효과 검증 (10 prompts)"
date: 2026-05-16
type: session
report_type: session
task: TM-149
status: active
verdict: APPROVE
tags: [report, qa, ai, generate, multi-step, asset-gen, character, validation, post-rca]
related:
  - "[[2026-05-15-TM-135-quality-rca-research]]"
  - "[[2026-05-15-TM-136-assetgen-singleshot]]"
  - "[[2026-05-15-TM-137-retro]]"
  - "[[2026-05-15-TM-138-vision-self-critique]]"
  - "[[2026-05-15-TM-139-retro]]"
  - "[[2026-05-15-TM-140-retro]]"
  - "[[2026-05-15-TM-141-retro]]" 
  - "[[2026-05-15-TM-145-retro]]"
  - "[[2026-05-15-TM-147-lottie-lambda-smoke]]"
  - "[[../01-pm/decisions/0022-character-rendering]]"
  - "[[../01-pm/decisions/0027-lottie-runtime]]"
provenance: extracted
---

# TM-149 — post-TM-135 stack 통합 효과 검증

## TL;DR — APPROVE

TM-135 RCA 후 머지된 stack (TM-136 ~ TM-147) 의 end-to-end 통합 효과를 10건 prompt 로 라이브 검증. **5/5 acceptance 통과**:

- character (5/5): asset-gen PNG 생성 성공, multi-step 2-scene 라우팅 모두 fire (`assetGenUsed:true, scenes:2, living_entity:true`)
- motion-graphics (3/3): single-shot 유지, 평균 9.4s, params 6.3개
- data-viz (2/2): single-shot 유지, 평균 17.5s, params 8.5개
- skeleton-echo marker: **0건** (TM-58 회귀 가드 유지)
- 비용: ~$1.6 (5 × gpt-image-1 + 10 × gpt-4o codegen)

전수 production stack(asset-gen 게이트 풀림 + CHARACTER 가이드라인 + multi-step default + RAG)이 의도대로 작동.

## Acceptance 매트릭스

| 기준 | 결과 | 임계 | 통과 |
|---|---:|---|:---:|
| character asset-gen 발동 | 5/5 | ≥ 4/5 | OK |
| character multi-step (≥2 scenes) | 5/5 | ≥ 4/5 | OK |
| motion-graphics generate 성공 | 3/3 | 5/5 (전체) | OK |
| data-viz generate 성공 | 2/2 | 5/5 (전체) | OK |
| skeleton-echo hit | 0 | == 0 | OK |
| **verdict** | | | **APPROVE** |

## Test corpus (10건)

Character/Scene (5건):
- C01 `곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘` (사용자 원본)
- C02 `강아지가 공원에서 뛰어가는 8초 애니메이션`
- C03 `고양이가 창가에서 자는 5초`
- C04 `robot dancing in cyber city, 6 seconds`
- C05 `person walking through forest, 10 seconds`

Motion-graphics 회귀 (3건): M01 counter-spring(blue), M02 빨간 카운터 0~100, M03 원형 스피너 8개점 파란색
Data-viz 회귀 (2건): D01 bar chart top-5, D02 line chart stock daily

## Per-row 결과 (요약)

| id | cat | scenes | asset-gen PNG | params | code(B) | latency(ms) | skel |
|---|---|---:|---|---:|---:|---:|---:|
| C01 | character | 2 | yes (4e6dd5...) | 1 | 4616 | 59973 | 0 |
| C02 | character | 2 | yes (e1bfd3...) | 1 | 4211 | 52274 | 0 |
| C03 | character | 2 | yes (dfba85...) | 1 | 5560 | 59892 | 0 |
| C04 | character | 2 | yes (fc5190...) | 1 | 4568 | 53626 | 0 |
| C05 | character | 2 | yes (f6f162...) | 1 | 5506 | 59163 | 0 |
| M01 | motion-graphics | – | – | 8 | 2206 | 12377 | 0 |
| M02 | motion-graphics | – | – | 8 | 2206 | 8155 | 0 |
| M03 | motion-graphics | – | – | 3 | 1177 | 7731 | 0 |
| D01 | data-viz | – | – | 8 | 3343 | 16709 | 0 |
| D02 | data-viz | – | – | 9 | 3560 | 18330 | 0 |

PNG 파일: `wiki/05-reports/screenshots/TM-149/asset-gen-png/4e6dd5*.png` (C01 곰돌이 1장 commit, 나머지 4장은 worktree `public/uploads/asset-gen/` 에 라이브 보존). 1장만 커밋하여 repo size 보존 (1.7MB).

## Stack 동작 증거 (dev 로그 발췌)

```
[pipeline] mode=multi-step stages=outline,scene-specs,asset-gen,scene-code,compose model=gpt-4o
[pipeline] done mode=multi-step totalMs=59432 scenes=2 assetGen=fresh
[pipeline]   stage=outline ms=6215 {"scenes":2,"living_entity":true,"min_scenes":2}
[pipeline]   stage=scene-specs+asset-gen ms=44766 {"sceneSpecs":2,"assetGenUsed":true,"assetGenCached":false}
...
[generateAsset] TM-74/TM-141 RAG hit: { category: 'counter', ref: 'counter-animation', community: null }
[generateAsset] TM-74/TM-141 RAG hit: { category: 'chart', ref: 'line-chart', community: 'stock-sparkline' }
```

확인된 stack 컴포넌트:
- TM-136 asset-gen 게이트 풀림 → character 5/5 모두 fresh 생성 (cache 0)
- TM-137 CHARACTER 가이드라인 → outline `living_entity:true` 라우팅
- TM-139 multi-step default ON → `min_scenes:2` 강제, 5/5 scenes=2
- TM-141 RAG → motion-graphics + data-viz 모두 ref hit (counter-animation, bar-chart, line-chart, stock-sparkline)
- TM-58 skeleton 회귀 가드 → 0/10 hit

## Before / After 비교

| 지표 | Before TM-135 (TM-85 r1, 2026-05-12) | After TM-135 (TM-149, 2026-05-16) |
|---|---|---|
| character mode_match | 10/10 (clarify expected) | n/a — clarify-gate가 concreteness 충족 시 generate 직행 |
| character asset-gen 발동 | 0/10 (single-shot, gate 막힘) | **5/5 (multi-step, fresh PNG)** |
| character 시각 결과 | 갈색 원 / 평면 single shape | 실제 일러스트 PNG (≥1.7MB, gpt-image-1) |
| character latency | ~7s (single-shot) | ~57s (multi-step + asset-gen) |
| motion-graphics latency | ~5s | ~9s (RAG 추가 토큰) |
| data-viz latency | ~10s | ~17s (RAG ref injection) |
| skeleton-echo hit | 0/30 | 0/10 |

핵심 transformation: **character pipeline에 실 일러스트 핸드오프가 들어왔다**. RCA D1/D2/D4 가 모두 라이브에서 동작.

## 미관측 / 후속 검증 권장

- **TM-138 vision self-critique loop**: 응답 metadata에 `selfCritique.score` 노출 X. 현 구현은 stage internal에서 retry 결정만 하고 외부 surface는 안 함. 향후 telemetry 노출 시 본 driver의 `judge_score` 컬럼이 자동 채워지도록 reaggregator 갱신 필요.
- **TM-140/144 Lottie 카탈로그**: 본 corpus 10건 모두 `CatalogueLottie` 미발동 (asset-gen 우선). Lottie 경로 검증은 TM-147 lambda smoke + Lottie picker UI E2E 로 별도 커버.
- **시각적 quality (judge ≥70 회귀)**: 본 run은 PNG 정상 생성 + multi-step 라우팅 무결성까지 확인. PNG 시각 품질은 GPT-4o vision judge 호출(TM-66 driver)로 별도 측정 권장 — 본 task 비용 cap (~$2) 안에서 5장 judge $0.50 추가 투자 가능 (next iter).

## 1차 driver 의 false-negative 회고

초기 `tm-149-stack-validation.mjs` 가 `asset_gen_used` 를 `imageUrl: 'https://'` 또는 `/api/asset/` 으로만 detect → 실제 production 경로(`/uploads/asset-gen/<sha>.png`) 미스. summary 가 character 0/5 로 나와 잠깐 REQUEST_CHANGES 판정. `tm-149-reaggregate.mjs` 로 DB(`Asset.code`)에서 직접 `/uploads/asset-gen/` 패턴 + 디스크 PNG 존재 검사로 재집계, 5/5 확인.

후속 driver 작성 시: 라이브 생성 결과는 항상 DB→코드→실제 URL 패턴 검증을 1순위로. API JSON metadata 만 의존하면 surface 변경에 취약.

## 산출물

- `scripts/qa/tm-149-stack-validation.mjs` — generate driver (10 prompts × 1 round)
- `scripts/qa/tm-149-reaggregate.mjs` — DB-기반 재집계 (정확도 ↑)
- `wiki/05-reports/screenshots/TM-149/results.json` — per-row 데이터
- `wiki/05-reports/screenshots/TM-149/summary.json` — 집계 + acceptance + verdict
- `wiki/05-reports/screenshots/TM-149/asset-gen-png/*.png` — 5 캐릭터 일러스트

## 다음 단계 추천

1. TM-66 vision judge 를 본 5장 PNG 에 적용 → 정량 품질 점수 (≥70 합격) 확인
2. TM-138 self-critique 결과를 `metadata.selfCritique` 로 응답에 노출 → 향후 모든 generate driver 가 자동 수집
3. TM-141 RAG impact A/B (RAG on vs off) 측정 — 본 run 은 RAG ON 한 측만 본 상태
4. character latency budget review: 56s 평균은 사용자 인내 한계 근방. 비용/지연 vs 품질 trade-off ADR 후속

## ADR 영향 없음

TM-149 는 검증 task (read-only). ADR-0001/0002/0003/0022/0027 모두 라이브 동작 확인만, 변경 없음.
