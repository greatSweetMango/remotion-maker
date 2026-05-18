---
title: TM-168 — imageUrl 합성 규칙 (PNG = full scene, no opaque overlay)
created: 2026-05-18
updated: 2026-05-18
tags: [report, session, validator, prompt-tuning, tm-168, tm-166]
status: active
report_type: session
provenance: extracted
---

# TM-168 — imageUrl rule: PNG = full scene, no opaque overlay

> TM-166 RCA 후속 Phase E #2 + #4. 단일 task 자율 실행 (TeamLead 직행 — build-team
> 미경유; deterministic validator + system prompt 강화는 단일 패스로 처리).

## 1. 컨텍스트

TM-166 RCA ([wiki/05-reports/2026-05-18-TM-166-composition-rca.md]) 가
multi-step 파이프라인이 asset-gen PNG 위에 (a) 보라색 솔리드 띠를 얹고,
(b) Scene2 에서 bare `imageUrl` 식별자를 참조하다 ReferenceError 로 폭사하는
실패 모드를 정확히 분류했다. 본 task 는 그 중 #2 + #4 (system prompt 강화 +
deterministic validator) 를 처리.

TM-167 은 같은 file (`src/lib/ai/prompts.ts`) 의 single-shot 측 CHARACTER
guideline 갱신을 별도로 처리. TM-168 은 multi-step `SCENE_CODE_SYSTEM_PROMPT`
+ generate.ts `ASSET_GEN_SYSTEM_PROMPT_ADDENDUM` + sandbox validator 측을
담당. 동일 file 충돌은 head edit 시 명시적으로 처리 (단, 본 PR 은 TM-167 영역과
직접 충돌하지 않는 별도 단락만 수정).

## 2. 변경 요약

### 2.1 Validator (`src/lib/remotion/sandbox.ts`)

신규 `validateImageUrlComposition(code)` — `PARAMS.imageUrl` 가 선언된
코드에 한해서만 발화하며 (no-op for non-image scenes), 3가지 규칙을 강제:

- **R1** — 모든 `<Img src={...}>` 의 src 표현은 다음 중 하나여야 함:
  - `PARAMS.imageUrl` (canonical)
  - destructured prop default (`({ imageUrl = PARAMS.imageUrl } = PARAMS)`)
  - literal string
  bare `imageUrl` 식별자 (TM-166 Scene2 버그) → reject.
- **R2** — `PARAMS.imageUrl` 가 선언됐는데 `<Img>` 가 단 하나도 없음 →
  reject. LLM 이 addendum 을 무시한 케이스.
- **R3** — `<Img>` 이후 source 순서로 나타나는 sibling `<AbsoluteFill>` /
  `<div>` 가 `backgroundColor` 만 있고 children/opacity/rgba 가 없으면
  reject. TM-166 보라색 띠 실패 모드.

`validateCode()` 의 deny-list 스캔 이후 호출되도록 wiring.

### 2.2 System prompt 강화

3개 위치 동시 갱신:

| 위치 | 변경 |
|---|---|
| `src/lib/ai/prompts.ts` — GENERATION_SYSTEM_PROMPT CHARACTER 섹션의 "Asset-gen hand-off" 단락 | "PARAMS.imageUrl 명시 사용, PNG=full scene, NO opaque overlay" 4-bullet 으로 확장 |
| `src/lib/ai/generate.ts` — ASSET_GEN_SYSTEM_PROMPT_ADDENDUM | single-shot 측 addendum 에 동일 규칙 5-step 으로 명시 + objectFit:'cover' full-bleed |
| `src/lib/ai/pipeline.ts` — generateSceneCode imageUrl 분기 | multi-step `SCENE_CODE_SYSTEM_PROMPT` 뒤에 붙는 IMAGE ASSET addendum 을 4-step 구조로 확장 (PARAMS.imageUrl 명시, spec stage 의 flowers/ground 무시, 오버레이 금지 명시 + validator 가 reject 한다는 사실 통지) |

### 2.3 테스트 (`__tests__/lib/remotion/sandbox.test.ts`)

신규 `TM-168 imageUrl composition rule` describe 블록 (10 cases):

Positive (5):
- full-bleed `<Img src={PARAMS.imageUrl}>` + no overlay
- destructured prop default `imageUrl = PARAMS.imageUrl`
- animated opacity overlay (motion layer, shorthand `{ opacity }`)
- rgba/transparent backgroundColor overlay
- non-image composition (no PARAMS.imageUrl) → no-op

Negative (4):
- bare `imageUrl` identifier (TM-166 Scene2 bug)
- PARAMS.imageUrl 선언 후 `<Img>` 없음
- 솔리드 `<AbsoluteFill>` overlay 위 `<Img>` (TM-166 purple-band)
- 솔리드 full-width `<div>` 200px band 위 `<Img>`

## 3. 검증

```
__tests__/lib/remotion/sandbox.test.ts        64 passed (10 new + 54 prior)
__tests__/lib/evaluator/sandbox-fuzz.test.ts  passed (no regression on 35-case fuzz corpus)
__tests__/lib/ai/generate.test.ts             passed
__tests__/lib/ai/generate-tm136-asset-gen.test.ts passed
__tests__/lib/ai/pipeline.test.ts             60 passed
```

TypeScript 체크: 본 변경분에서 신규 에러 0 건 (pre-existing 에러는 wiki
screenshots/fixtures 영역).

## 4. False-positive 영향 평가

- `validateImageUrlComposition` 는 `PARAMS.imageUrl:` 가 선언된 코드에서만
  발화. 35-case TM-43 fuzz corpus 통과 (non-image 케이스에 영향 없음 확인).
- R3 의 "opaque overlay" 정의는 deliberately narrow:
  - self-closing `<AbsoluteFill|div .../>` 에 한정 (children 있는 wrapper 는
    motion-layer 로 간주, 통과).
  - opacity 키 (`opacity:` 또는 ES shorthand `{ opacity }`) 있으면 통과
    (animated fade overlay 허용).
  - `backgroundColor: 'rgba(...)'` 또는 `'transparent'` 명시 시 통과.
- LLM 이 정상적인 합성 (Img 위 motion-caption wrapper + parallax 등) 을
  emit 하면 모두 통과. TM-166 의 정확한 실패 shape 만 차단.

## 5. 향후 (Phase E 잔여)

본 PR 미커버:

- #3 — AST 기반 composition-lint (현재는 regex heuristic). 정확도 향상 시
  별도 TM-XXX 로.
- #5 — headless React snapshot + visual judge (composition 자체 평가).
- #6 — spec ↔ asset-gen handshake (spec stage 에 "flowers already drawn"
  통지).
- #8 — asset-preview regression corpus 에 "곰돌이 초원 산책" 케이스 등록.

## 6. Cross-references

- [[05-reports/2026-05-18-TM-166-composition-rca|TM-166 RCA]] — 본 task 의
  근거. Phase E #2 (prompt) + #4 (validator) 처리.
- [[01-pm/decisions/0002-params-auto-extract|ADR-0002]] — PARAMS 컨벤션.
  `imageUrl` 도 PARAMS 키이므로 본 규칙은 그 추가 검증 layer.
- `src/lib/remotion/sandbox.ts:229+` — 새 validator.
- `src/lib/ai/generate.ts:441-475` — ASSET_GEN addendum 강화.
- `src/lib/ai/pipeline.ts:714-741` — SCENE_CODE addendum 강화.
- `src/lib/ai/prompts.ts:363-383` — CHARACTER 섹션 asset-gen 단락 강화.
