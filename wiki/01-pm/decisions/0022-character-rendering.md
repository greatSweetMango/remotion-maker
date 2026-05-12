---
title: "ADR-0022: 캐릭터/장면 렌더링 capability 전략"
created: 2026-05-12
updated: 2026-05-13
tags: [decision, area/ai, area/edit, area/cost]
status: proposed
related: [ADR-0001, ADR-0002, ADR-0003, ADR-0019, ADR-0020]
provenance: extracted
---

# ADR-0022: 캐릭터/장면 렌더링 capability — image-gen 우선 hybrid

## TL;DR

캐릭터/동물/사람/내러티브 장면 프롬프트는 **코드만으로는 충실히 렌더 불가**. 1차로 **외부 image-gen API (옵션 B, gpt-image-1)** 를 통합해 정적 캐릭터 자산을 생성 후 Remotion `<Img>` 위에 모션 레이어를 합성한다. 2차로 **고빈도 카테고리에 한해 SVG 자산 라이브러리 (옵션 A)** 를 보강해 비용/캐시 효율을 끌어올린다. 옵션 C(generative SVG path)는 라인아트 한정 실험 카테고리로만 유지.

## 컨텍스트

PR #127 ([b2f955c](../../../../commit/b2f955c)) 에서 다음 capability gap 이 드러났다:

```
prompt: "곰돌이 캐릭터가 초원을 걸어가는 10초 애니메이션"
before fix: mode=generate, code=967 chars of skeleton (no bear content)
after  fix: mode=clarify, 4 questions
```

clarify 4문(style / appearance / mood / time-of-day)에 사용자가 답해도, **현재 generation pipeline은 caller가 "cartoon 2D illustration" 같은 style hint를 줘도** 곰의 형상을 충실히 그리는 능력이 없다. 결과적으로 default counter/text 템플릿으로 fallback. 35개 motion-graphics 템플릿(`src/lib/templates.ts`)은 data-viz / typography / shape-motion 위주이고 캐릭터 자산은 0개.

관련 ADR:
- [[0001-edit-not-equal-render|ADR-0001]] (편집 ≠ 렌더) — 자산 생성 비용이 편집 latency/cost 모델에 영향
- [[0002-customize-ui-auto-extract|ADR-0002]] (PARAMS 자동추출) — 새 자산 경로도 PARAMS 컨벤션 지켜야 함
- [[0003-prompt-caching|ADR-0003]] (프롬프트 캐싱) — 이미지 생성은 LLM 캐시 키와 별도 트랙
- [[0019-rag-templates|ADR-0019]] (RAG 템플릿) — SVG 라이브러리 옵션과 직접 연관
- [[0020-multi-step-pipeline|ADR-0020]] (멀티스텝 파이프라인) — outline → scene-spec → scene-code 에 asset 단계를 어디에 끼울지

## 옵션 비교

| 기준 | A. SVG asset library | B. Image-gen API (gpt-image-1 / DALL-E 3) | C. Generative SVG path |
|---|---|---|---|
| **품질 (캐릭터)** | 디자이너가 만든 자산 = 가장 안정적, 그러나 유한 카탈로그 | 임의 프롬프트 커버, 스타일 일관성은 seed/style ref로 통제 | 라인아트만 가능. 곰돌이 같은 친근 형상엔 부적합 |
| **장면 다양성** | 자산 N개 × 포즈 K개 = 한정 | 무제한 (프롬프트 그대로) | 추상/기하 한정 |
| **추가 비용 / asset** | $0 (정적) + LLM은 asset id만 선택 → 현행 ~$0.005 유지 | **tier별 (TM-92 실측)**: low **$0.0111**, medium **$0.0425**, high **$0.1666** (1024² 1콜). 권고 default=low → 현행 $0.005 + $0.011 ≈ $0.016 (3× 인상). 캐릭터 한정 medium opt-in. 상세: [[../../05-reports/2026-05-13-TM-92-tier-bench\|TM-92 bench]] | $0 (코드만) |
| **Latency** | 즉시 (정적 fetch) | 5–15초 (image-gen round trip) | 즉시 |
| **편집 호환** ([[0001-edit-not-equal-render\|ADR-0001]]) | 완전 호환 — 자산은 staticFile, 편집은 LLM only | **부분 호환** — 첫 generate에서만 image-gen, 이후 편집은 캐시된 이미지 URL 재사용 → LLM only 유지 | 완전 호환 |
| **PARAMS 호환** ([[0002-customize-ui-auto-extract\|ADR-0002]]) | `assetId: "bear-walking-01" // type: select, options: ...` | `imageUrl: "https://..." // type: image` (신규 type) + `prompt: "..." // type: text` (재생성 트리거) | 기존 numeric/color params 그대로 |
| **캐싱 호환** ([[0003-prompt-caching\|ADR-0003]]) | 영향 없음 — 코드/시스템 프롬프트 캐시 키 유지 | **신규 캐시 레이어 필요** — `hash(prompt+style+seed) → R2 URL` (자산 영속 저장). LLM 캐시 키는 imageUrl(string)로 안정 | 영향 없음 |
| **구현 난이도** | 중 (자산 수급 + 큐레이션 + 메타데이터 + 라이선스) | 중 (API 키 관리, R2 업로드 큐, 큐 재시도, NSFW 정책) | 저 (라이브러리 wrap) |
| **법적/정책** | 자산 라이선스 (Lottie, Storyset, unDraw 등) 검토 필요 | OpenAI image-gen — animal/character OK, 실존인물·로고 제한, 워터마크 정책 확인 필요 | 무관 |
| **사용자 UX** | 즉시 카탈로그 미리보기 → 선택형 | "생성 중…" 5–15초 대기, but 그 후엔 캐릭터 그대로 | 추상도 높아 캐릭터 기대 충족 불가 |
| **벤더 락인** | 없음 (정적 파일) | OpenAI 1개 벤더, but 추상화 layer로 Imagen/Stability 교체 가능 | 없음 |

추정 비용 영향 (현재 ~$0.005/edit + Pro $12/월 마진 64% — [[0001-edit-not-equal-render\|ADR-0001]] 결과):
- 옵션 A 단독: 변화 없음. 단 캐릭터 cover율 = 카탈로그 크기에 비례 (현실적으로 20–40%).
- 옵션 B 단독: $0.005 → $0.045/asset (9× 인상). 단 **캐시 적중 시 후속 편집은 $0.005 유지** — 캐릭터 자산은 보통 1회 생성 후 모션 파라미터만 조정. 첫 생성만 +$0.04.
- Hybrid (B → A 보강): A로 hit한 카테고리는 $0.005 유지, miss 시에만 B fallback. cover율은 100% 유지하면서 평균 cost 절감.

## 결정

**1차 (이번 사이클): 옵션 B (image-gen API)** 통합.
- Provider: OpenAI `gpt-image-1` (DALL-E 3 후속, 2025년 출시, 더 강한 캐릭터 일관성). API 키는 기존 `OPENAI_API_KEY` 재사용.
- 호출 위치: `src/lib/ai/generate.ts`의 multi-step pipeline ([[0020-multi-step-pipeline\|ADR-0020]]) 에서 **scene-spec → asset-resolve → scene-code** 사이에 신규 `asset-gen` 스테이지 추가.
- Trigger 조건: clarify 응답에 character/animal/person 시그널이 있고 + 사용자가 style hint를 줬을 때만. 그 외 카테고리(data-viz, typography)는 **호출 X** (cost guard).
- Caching: `hash(prompt + style + seed) → R2 key`. R2 URL을 PARAMS의 `imageUrl` 필드로 노출 → ADR-0001 유지(편집 시 재호출 없음).
- PARAMS 신규 type:
  - `imageUrl: "https://..." // type: image, regen_prompt: "곰돌이 캐릭터"` — customize UI에 "Regenerate" 버튼 노출 (별도 follow-up task).
- 비용 가드: per-org budget hook ([[0006-spend-autotrack\|ADR-0006]]) 에 `image-gen` 라인 추가. 무료/Free tier 사용자는 **카탈로그(A) 한정**, Pro 이상만 image-gen 활성.

**2차 (follow-up): 옵션 A 보강.**
- 고빈도 카테고리(곰, 강아지, 사람-기본포즈, 자연풍경)부터 큐레이션 SVG 20–40개.
- 자산 메타데이터: `{ id, tags, license, defaultPalette, animatableParts: ["body","leftArm",...] }`.
- LLM은 spec 단계에서 asset id를 선택 → image-gen 호출 skip → cost 절감.

**옵션 C: 별도 실험.** 라인아트 wireframe 카테고리에서만 사용 (현 ADR 결정 영향 없음).

## 결과 / 영향

- **사용자 UX**: "곰돌이 캐릭터가 초원을 걸어가는" 같은 프롬프트가 **실제 곰 이미지가 모션과 함께 나오는** 영상으로 렌더됨. 단 첫 generate에 5–15s 추가 latency. 진행 UI(progressive: "캐릭터 생성 중…") 필요.
- **비용**: 첫 generate +$0.04 (image-gen). 캐시/편집은 $0.005 유지. Pro $12 마진은 캐시 적중률 ≥ 70% 가정 시 50% 이상 유지 가능. (정확 시뮬레이션 = 별도 task)
- **ADR-0001 호환**: 편집 ≠ 렌더 유지. image-gen은 generate 1회 한정.
- **ADR-0003 캐싱**: 시스템 프롬프트 캐시 키 영향 없음. 이미지는 별도 R2 캐시.
- **신규 의존성**: 없음 — OpenAI SDK는 이미 사용 중. R2 도 이미 사용 중([[0013-storage-abstraction\|ADR-0013]]).
- **보안/정책**: image-gen 응답에 대한 NSFW 필터 (OpenAI 기본 + 자체 키워드) 확인. 실존인물 프롬프트는 거부.
- **회귀 위험**: clarify-gate(PR #127) 와 충돌 없음 — clarify는 그대로 묻고, generate 단계에서 character 시그널이면 asset-gen 추가.

## 비채택 사유 (옵션 A 단독, 옵션 C 단독)

- **A 단독**: 카탈로그 cover율이 항상 < 100%. miss 시 사용자는 다시 default fallback → PR #127이 해결하려 한 UX 문제가 재발.
- **C 단독**: 추상 라인아트로는 "친근한 곰돌이" 등 감성적 캐릭터 요구를 충족할 수 없음.

## 후속 작업 (spawn)

- **TM-NEXT-1**: `asset-gen` 스테이지 spike (mock OpenAI image-gen, 1 prompt end-to-end). 본 PR에는 미포함.
- **TM-NEXT-2**: PARAMS 신규 type `image` + customize UI Regenerate 버튼.
- **TM-NEXT-3**: R2 asset 캐시 + hash key 설계 + TTL/cleanup 정책.
- **TM-NEXT-4**: spend-autotrack에 image-gen 라인 추가 + Free tier 차단.
- **TM-NEXT-5**: 옵션 A SVG 카탈로그 큐레이션 (20–40 자산, 라이선스 확인).
- **TM-NEXT-6**: NSFW/실존인물 정책 가드 + 실패 시 fallback UX.

## 출처 / 링크

- PR #127: `git show b2f955c` — character/scene clarify gate
- 코드: `../../../src/lib/ai/prompts.ts:225-240` (character/scene clarify rule)
- 코드: `../../../src/lib/ai/generate.ts` (현 generation pipeline)
- 코드: `../../../src/lib/templates.ts` (35 motion-graphics 템플릿, 캐릭터 0)
- 비용 모델: [[../overview|overview]] §pricing, [[../decisions/0006-spend-autotrack|ADR-0006]]
- Remotion `<Img>` / `staticFile`: `node_modules/remotion/dist/docs/` (정적 자산 렌더 패턴)
