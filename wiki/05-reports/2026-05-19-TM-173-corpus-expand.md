---
title: "TM-173 — Regression corpus 확장 + composition critique 통합 측정"
created: 2026-05-19
updated: 2026-05-19
tags: [report, qa, ai, generate, multi-step, asset-gen, character, regression, tm-149, tm-166, tm-171, tm-168]
status: active
report_type: session
period: "2026-05-19"
author: "TeamLead (TM-173)"
provenance: extracted
related:
  - "[[2026-05-16-TM-149-stack-validation]]"
  - "[[2026-05-18-TM-166-composition-rca]]"
  - "[[2026-05-18-TM-168-imageurl-overlay-rule]]"
  - "[[2026-05-19-TM-171-composition-judge]]"
verdict: REQUEST_CHANGES
---

# TM-173 — Regression corpus 확장 + composition critique 통합 측정

## TL;DR — REQUEST_CHANGES (regression detected)

TM-149 corpus(10)에 TM-166 sentinel + 2 character variants를 추가해 13건 corpus로 확장하고, TM-138 self-critique / TM-171 composition critique / TM-168 validator 통과 여부까지 측정하는 신규 driver(`scripts/qa/tm-173-stack-validation.mjs`)를 도입. **첫 라이브 실행에서 즉시 회귀 발견**:

- **character 8건 중 7건이 `clarify-followup failed`** — multi-step 파이프라인이 TM-168 validator(R1, bare `imageUrl` identifier 금지)를 통과 못 해 single-shot로 fallback → single-shot이 또 clarify를 반환 → 자산 0건 생성.
- **TM-171 composition critique 0회 발화** — 어떤 character case도 asset-gen finalize 단계에 도달 못 함. AI_COMPOSITION_CRITIQUE=1 환경이었지만 측정 가능한 score 가 없음.
- motion-graphics(3/3) + data-viz(2/2) 영향 없음 — single-shot, imageUrl 미사용 경로.

**검증 가치 확정**: corpus 확장 자체가 TM-167/168 머지 이후의 첫 통합 테스트였고, 즉시 production-blocking regression을 잡아냈다. PR 머지 거부 + TM-174 후속 task 권고 (multi-step `pipeline.ts` SCENE_CODE generator 가 `scene{N}_imageUrl` 대신 `PARAMS.imageUrl` 직접 참조하도록 prompt 강화 + sanitize fixer 추가).

## 무엇이 바뀌었나

### 1. Corpus 확장 (10 → 13건)

| ID | Category | 비고 |
|---|---|---|
| **C00** (신규) | character | TM-166 user case sentinel: "곰돌이의 초원 산책 — 10초 정도의 횡스크롤 애니메이션" — purple-band/Scene2 imageUrl 회귀 영구 감시 |
| **C06** (신규) | character | "우주비행사가 달 표면에서 점프하는 7초" — 다양한 entity (인간/우주) |
| **C07** (신규) | character | "a dragon flying over snowy mountains, 8 seconds" — fantasy entity + 다른 scene 타입 |
| 나머지 10건 | — | TM-149 corpus 그대로 (C01-C05, M01-M03, D01-D02) |

### 2. 신규 driver — `scripts/qa/tm-173-stack-validation.mjs`

TM-149 driver를 superset으로 확장. 측정 추가 컬럼:

- `judge_score` / `judge_below_threshold` — TM-138 `selfCritique`
- `composition_score` / `composition_below_threshold` — TM-171 `compositionCritique` (`AI_COMPOSITION_CRITIQUE=1` 필요)
- `composition_latency_ms` / `composition_extra_cost_usd`
- `validator_rejection` / `validator_pass` — generate 성공 여부와 TM-168 rejection 시그니처 패턴 매칭

### 3. Phase C — auto-judge fail UX

driver가 `judge_score < 70` 또는 `composition_score < 70` 또는 validator/error case 마다 `summary.fail_followups[]` 항목을 자동 생성:

```json
{
  "source_case_id": "C00",
  "category": "character",
  "prompt": "...",
  "reasons": ["composition_score=42 < 70"],
  "recommended_action": "Inspect composition (TM-166-class). ...",
  "suggested_task_title": "Fix regression: C00 (character) — composition_score=42 < 70",
  "asset_id": "..."
}
```

Orchestrator/PM이 manual triage 없이 follow-up task 를 spawn할 수 있는 머신-리더블 권고. 현 라이브 실행에서는 7건 validator/error follow-up이 생성됨.

## 라이브 실행 (1회, ~$0 — character 8건 모두 asset-gen 도달 못해 image cost 0)

- 시작: 2026-05-19 06:25:02 UTC
- 종료: 2026-05-19 06:37:00 UTC (~12분)
- 환경: `AI_COMPOSITION_CRITIQUE=1`, BASE_URL=`http://127.0.0.1:3173`
- raw: `wiki/05-reports/screenshots/TM-173/{results,summary}.json`

### Acceptance 매트릭스

| 항목 | TM-149 baseline (2026-05-16) | TM-173 today | 통과 |
|---|---|---|---|
| character mode_match | 5/5 (100%) | 8/8 (100%) | ✅ |
| **character asset-gen used** | **5/5 (≥4)** | **0/8 (≥7)** | ❌ |
| motion-graphics mode_match | 3/3 | 3/3 | ✅ |
| data-viz mode_match | 2/2 | 2/2 | ✅ |
| skeleton_hits | 0 | 0 | ✅ |
| **validator_pass_all** | n/a | **6/13** | ❌ |
| judge_score 측정 | n/a | 0/13 (no asset to judge) | — |
| composition_score 측정 | n/a | 0/13 (no PNG to render) | — |

### 회귀 발견 — TM-168 × multi-step 충돌

dev server 로그가 반복적으로 출력:

```
[TM-111] multi-step pipeline failed, falling back to single-shot:
  TM-102 composed code failed sandbox validation after TM-111 sanitize:
    imageUrl rule: <Img src={scene0_imageUrl}> must reference PARAMS.imageUrl
      (or a destructured `imageUrl` prop) — bare identifier is undefined at scene-fragment scope,
    imageUrl rule: <Img src={scene1_imageUrl}> must reference PARAMS.imageUrl
      (or a destructured `imageUrl` prop) — bare identifier is undefined at scene-fragment scope
```

원인:

1. **TM-168 R1** (`src/lib/remotion/sandbox.ts:316`) 가 `<Img src>` 가 `PARAMS.imageUrl` / `props.imageUrl` / 리터럴 문자열 / destructured prop 이 아니면 reject.
2. multi-step `pipeline.ts` 의 SCENE_CODE generator 가 scene fragment 마다 `scene0_imageUrl`, `scene1_imageUrl` 같이 scoped 변수명을 emit. TM-102 compose 단계가 이를 그대로 stitching 한 후 validator 가 reject → TM-111 fallback.
3. single-shot fallback 가 또 clarify 를 반환 → C00-C05, C07 모두 자산 미생성.

C06 ("우주비행사")만 multi-step 우회 + single-shot 단발 성공 (asset_gen_used=false → 정적 코드, PNG 없음).

### Fail follow-ups (7건, summary.fail_followups[])

전부 character — C00 (TM-166 sentinel), C01, C02, C03, C04, C05, C07.

## 왜 / 배경

TM-149 corpus 는 TM-135 stack 안정화 시점 (2026-05-16) 의 baseline. 그 뒤 TM-166 RCA → TM-167/168 (validator + prompt 강화) → TM-171 (composition critique) 가 차례로 머지됐는데, 통합 회귀 검증을 따로 안 돌렸다. TM-173 task 는 정확히 그 gap을 메우기 위해 만들어졌고, 의도대로 작동했다 — 머지 후 첫 라이브 실행에서 production-blocking regression을 발견.

## 영향

### 코드 / 시스템
- multi-step character 경로 **사실상 break** — 모든 multi-scene character 요청이 single-shot fallback 후 clarify-loop 에 빠짐.
- single-shot character (C06) 만 동작, 그것도 PNG 없음.
- motion-graphics + data-viz 정상.

### 사용자
- TM-166 user case ("곰돌이 초원 산책") 가 자산을 못 만들고 무한 clarify — 실제 user 대화 차단.
- character + scene 류 모든 요청에 영향.

### 비용
- 이번 라이브 실행: gpt-4o codegen × 21 회 (clarify + generate) ≈ $0.30. PNG/image-gen 비용 0 (asset-gen 미발화).
- 회귀 미해결 시 production: character 요청 마다 multi-step 비용을 두 번 (multi-step + fallback) 청구하면서 결과물 없음 → bad UX + 비용 낭비.

### 검증 인프라
- TM-173 corpus + driver 가 회귀 안전망으로 검증됨. 향후 PR pre-merge gate 로 권고.

## 후속 / 다음

- [ ] **TM-174 (긴급)** — `src/lib/ai/pipeline.ts` SCENE_CODE generator + sanitizer 수정: scene fragment 의 `<Img src={sceneN_imageUrl}>` 패턴을 `<Img src={PARAMS.imageUrl}>` 로 자동 rewrite, 또는 SCENE_CODE_SYSTEM_PROMPT 에 "**모든 `<Img>` 는 `PARAMS.imageUrl` 만 참조**" 강제. 📅 2026-05-19
- [ ] TM-168 validator R1 의 multi-step compatibility 회고 — 의도된 규칙이긴 하지만 multi-step generator 가 규칙을 위반하는 코드를 일관되게 생성하는 상태로 머지된 것은 reviewer 누락. ADR 또는 TM-168 후속 회고.
- [ ] TM-173 corpus 를 pre-merge CI gate 후보로 검토 — character 머지마다 라이브 13건 (~12분, ~$2) 돌릴 가치 있음.
- [ ] TM-174 fix 후 재실행 → before/after 비교 보고서로 update.

## 출처 / 링크

- 코드 (신규): `scripts/qa/tm-173-stack-validation.mjs`
- 결과: `wiki/05-reports/screenshots/TM-173/results.json`, `summary.json`
- 회귀 원천: `src/lib/remotion/sandbox.ts:294` (`validateImageUrlComposition`), `src/lib/ai/pipeline.ts` (SCENE_CODE generator)
- 비교: `wiki/05-reports/2026-05-16-TM-149-stack-validation.md`
- RCA 맥락: `wiki/05-reports/2026-05-18-TM-166-composition-rca.md`
- TM-168 머지: `wiki/05-reports/2026-05-18-TM-168-imageurl-overlay-rule.md`
- TM-171 머지: `wiki/05-reports/2026-05-19-TM-171-composition-judge.md`
