---
title: "TM-136 — asset-gen 게이트 풀기 (single-shot 경로 배선 + !opts.answers 가드 제거)"
created: 2026-05-15
updated: 2026-05-15
type: session
report_type: session
task: TM-136
status: active
tags: [report, ai, generate, asset-gen, character, fix, p0]
related:
  - "[[2026-05-15-TM-135-quality-rca-research]]"
  - "[[2026-05-13-TM-90-asset-gen-integration]]"
  - "[[2026-05-13-TM-84-asset-gen-spike]]"
  - "[[../01-pm/decisions/0022-character-rendering]]"
provenance: extracted
---

# TM-136 — asset-gen 게이트 풀기

## TL;DR

TM-135 RCA에서 단일 최대 결함으로 식별된 **dead-code asset-gen** 문제 해결.
`src/lib/ai/generate.ts` single-shot 경로에 `runAssetGenStage` 호출을 배선하고,
LLM 시스템 프롬프트에 TM-136 addendum을 추가하여 `<Img src={PARAMS.imageUrl} />`
사용을 강제. LLM 응답 후 placeholder 치환 + `imageUrl` PARAMS 백필을 수행하는
`finalizeWithAssetGen` 단계 추가.

**라이브 검증 통과**: 사용자 원본 프롬프트 "곰돌이가 초원을 걸어가는 약 10초분량의
횡스크롤 애니메이션 만들어줘" 재현 시:
- Round 1 (clarify): asset-gen skip → $0 (이전과 동일)
- Round 2 (generate with answers): asset-gen fire → 1.9MB PNG 생성 → `imageUrl`이
  PARAMS에 자동 주입 → 코드에 `<Img src={imageUrl} ...>` 삽입 → 갈색 원이 아닌
  실제 만화 곰돌이 PNG가 horizontal scroll 됨

---

## 변경 요약

### 1. `src/lib/ai/generate.ts`

핵심 변경 4개:

**A. `!opts.answers` 가드 제거 (line 383 부근)**
```diff
- if (process.env.AI_MULTI_STEP === '1' && !opts.answers) {
+ if (process.env.AI_MULTI_STEP === '1') {
```
clarify 답변이 들어와도 multi-step 진입 가능. 단, single-shot path에 asset-gen이
배선됐기 때문에 multi-step ON 여부와 무관하게 character/scene 프롬프트는 PNG를 받음.

**B. `generateAsset` → `generateAssetSingleShot` → `generateAssetSingleShotCore` 3계층 구조**
- `generateAssetSingleShot`: 진입 직후 living-entity 감지 → `runAssetGenStage` 호출 →
  결과를 `assetGenAddendum`으로 변환하여 core에 전달 → 응답을 `finalizeWithAssetGen`로 후처리.
- `generateAssetSingleShotCore`: 기존 LLM 오케스트레이션 (RAG, clarify, TM-51/52/67/68/95/100/105
  retry 분기 모두 그대로 보존).
- 모든 retry 분기의 다발성 return 사이트에 injection 로직을 흩뿌리지 않고 한 곳에서 후처리.

**C. `ASSET_GEN_SYSTEM_PROMPT_ADDENDUM` (export)**
- LLM에게 `PARAMS.imageUrl` 사용 + `<Img src={PARAMS.imageUrl} ...>` 렌더링 + 위치/스케일
  애니메이션을 PNG 주변에서 수행하라고 지시.
- `imageUrl: "TM136_IMAGE_URL_PLACEHOLDER", // type: text` placeholder를 emit하라고 명시.
- **suffix-only 추가**로 ADR-0003 prompt cache 키 안정성 유지 (RAG addendum 다음에 append).

**D. `injectAssetImageUrl` (export, 순수 함수)**
- 1차: placeholder `TM136_IMAGE_URL_PLACEHOLDER` 발견 시 실제 URL로 치환.
- 2차: placeholder 부재 + `imageUrl` 키 부재 시 PARAMS 첫 필드로 백필 (`// type: text`).
- 3차: 이미 다른 imageUrl 값이 있거나 PARAMS 자체가 없으면 no-op.
- 후속 `finalizeWithAssetGen`에서 `validateCode` + `transpileTSX` + `extractParameters`
  재실행. 어떤 단계에서든 실패하면 원본 코드로 폴백 (사용자 차단 X).

**E. asset-gen 발동 게이트**
- `eligibleForAssetGen = !!opts.answers && Object.keys(opts.answers).length > 0`
- Round 1 (clarify-only)에서 PNG 생성하면 $0.04 확정 낭비. Living-entity 프롬프트는 TM-95
  narrow rule에 의해 항상 round 1이 clarify로 끝나므로, 답변이 들어올 때만 PNG 생성.
- 첫 generation의 cost = $0.04, 이후 edits는 cache hit ($0).

**F. test seam 추가**
- `GenerateOptions.__assetGenStage`: 단위 테스트가 `runAssetGenStage`를 stub할 수 있도록.
- `GenerateOptions.disableAssetGen`: cost-sensitive bench에서 PNG 생성 끄기.

### 2. `src/app/api/generate/route.ts`

`assetGenStages.asset_gen_used`가 항상 `false`로 hardcode되던 것을 실제 발동 여부로
변경. PNG 사용 시 `assetGenCached`, `assetGenLatencyMs`, `assetGenCostUsd`를 stage meta에
추가하여 dev badge / 텔레메트리에 표시.

### 3. 테스트

신규 `__tests__/lib/ai/generate-tm136-asset-gen.test.ts` (11 tests):
- `injectAssetImageUrl` 4 케이스 (placeholder 치환 / 백필 / 기존값 보존 / PARAMS 부재).
- `generateAsset` single-shot 7 케이스:
  - living-entity + answers → asset-gen + URL 주입 + addendum 노출 검증.
  - clarify 답변 round → **TM-135 회귀 시나리오 재현** + 백필 경로 검증.
  - data-viz 프롬프트 → asset-gen 우회 (zero spend).
  - asset-gen 실패 → vector-only로 폴백 (사용자 차단 X).
  - `disableAssetGen` 옵션 동작.
  - **round-1 (no answers) → asset-gen skip** ($0.04 낭비 방지).
  - addendum suffix-only 보장 (cache key 안정성).

기존 모든 AI/route 테스트 304건 PASS.

---

## 라이브 검증 (Phase C)

환경: `worktrees/TM-136-assetgen-gate`, `localhost:3136`, `OPENAI_API_KEY=set`,
`AI_MULTI_STEP=unset` (= prod default).

### Round 1 — clarify (no answers)

```bash
POST /api/generate { "prompt": "강아지가 공놀이하는 5초 애니메이션" }
```
응답: `{ type: "clarify", questions: [...] }`. **`public/uploads/asset-gen/` empty** —
asset-gen fire 안 함 ($0 spend).

### Round 2 — generate (with answers)

```bash
POST /api/generate {
  "prompt": "강아지가 공놀이하는 5초 애니메이션",
  "answers": { "visual_style": "cartoon", "background": "park", "dog_breed": "shiba" }
}
```
HTTP 200, 44.2s 벽시계 (PNG 생성 ~25s + LLM ~17s). 응답 검사:
- `asset.code` 내 `imageUrl: "/uploads/asset-gen/d746e...png"` ✓
- `<Img src={imageUrl} ...>` JSX 사용 ✓
- `TM136_IMAGE_URL_PLACEHOLDER` 잔존 0 ✓
- `public/uploads/asset-gen/d746eca122e9...png` (실제 만화 강아지 PNG, ~1.9MB) ✓

**비용**: round 2 만 $0.04 = 사용자 명시 승인 budget 내.

### 곰돌이 시나리오 (TM-135 사용자 보고 원본)

```bash
POST /api/generate {
  "prompt": "곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘",
  "answers": { "bear_style":"cartoon", "background_detail":"detailed",
               "color_palette":"natural", "bgm_mood":"cheerful" }
}
```
생성된 코드:
```tsx
const PARAMS = {
  bearStyle: "cartoon", // type: text
  backgroundDetail: "detailed", // type: text
  colorPalette: "natural", // type: text
  bgmTrack: "audio/upbeat-runner.mp3", // type: bgmTrack
  bgmVolume: 0.6, // type: number, min: 0, max: 1, step: 0.05
  imageUrl: "/uploads/asset-gen/475ed7058295...png", // type: text
} as const;

return (
  <AbsoluteFill style={{ backgroundColor: '#87CEEB' }}>
    <CatalogueAudio track={bgmTrack} volume={bgmVolume} />
    <div style={{ position: 'absolute', width: '300%', height: '100%',
                  background: 'linear-gradient(to right, #98FB98, #32CD32)',
                  transform: `translateX(${translateX}px)` }} />
    <Img src={imageUrl} style={{ position: 'absolute', width, height,
                                  objectFit: 'contain',
                                  transform: `translateX(${translateX}px)` }} />
  </AbsoluteFill>
);
```

**TM-135에서 생성됐던 갈색 원 → 만화 곰돌이 PNG로 교체 완료.**

---

## 알려진 한계 / 후속

1. **첫 generation latency**: PNG 생성에 25-40s. 사용자 첫 응답이 느려짐. progressive UI
   또는 streaming이 필요 (별도 task — TM-135 D5/D7 권고와 결합 가능).
2. **Cache 단일 프로세스**: in-memory + 로컬 디스크 캐시. multi-instance prod에 R2
   migration 필요 (ADR-0022 follow-up).
3. **PNG 카테고리 한정**: 캐릭터/동물/사람만. 풍경 / 추상 / data-viz는 여전히 vector-only
   (의도된 동작, 비용 이유).
4. **System prompt 캐릭터 가이드 부재 (TM-135 D2)**: 이 PR에서는 안 다룸. asset-gen이
   PNG를 깔아주므로 vector 캐릭터 그리기 강제 자체가 약화되었지만, PNG 실패 시 대안 없음.
   별도 task로 분리 권고 (TM-137 후보).

---

## 회고

### 잘 된 점
- TM-135 RCA가 매우 명확했음 — D1 fix 위치 (`generate.ts:383`)와 의도된 효과가
  거의 1:1 매칭. 30 LOC 변경 약속이 100 LOC 정도로 fall short했지만, 그것도 finalize +
  test seam + telemetry 강화 때문이지 핵심 fix는 정확히 30 LOC.
- 라이브 재현이 깨끗하게 성공 — clarify path 영향 0, generate path는 PNG 출력 100%.
- Test 11건이 inject 함수 / wiring / no-fire / 실패 폴백을 모두 커버.

### 개선할 점
- 처음에 round-1 clarify에서도 asset-gen이 fire하여 $0.04 낭비 발생. 라이브 테스트에서
  발견하고 즉시 가드 추가. RCA 보고서에 "TM-95 narrow rule이 항상 round 1을 clarify로
  보낸다"는 내용이 있었으니 미리 인지했어야 함.

### TM-135 권고 진행 상황
- D1 (이 task) ✓ 완료
- D2 system prompt character 가이드 → TM-137 후보
- D3 vision-guided self-critique → TBD
- D4 multi-step default ON for character → TBD
- D5-D8 → 장기

---

## 출처

- 이전 RCA: `wiki/05-reports/2026-05-15-TM-135-quality-rca-research.md`
- 코드: `src/lib/ai/generate.ts`, `src/app/api/generate/route.ts`
- 테스트: `__tests__/lib/ai/generate-tm136-asset-gen.test.ts`
- ADR: `[[../01-pm/decisions/0022-character-rendering|ADR-0022]]`
