---
title: "TM-135 — 생성 품질 RCA + 개선 로드맵 (사용자 보고: 곰돌이 → 갈색 원)"
date: 2026-05-15
type: session
report_type: session
task: TM-135
status: active
tags: [report, qa, ai, generate, rca, capability-gap, asset-gen, multi-step, character, scene, judge]
related:
  - "[[2026-05-13-TM-85-pipeline-quality]]"
  - "[[2026-05-13-TM-90-asset-gen-integration]]"
  - "[[2026-05-13-TM-92-tier-bench]]"
  - "[[2026-05-14-TM-124-timing]]"
  - "[[../01-pm/decisions/0020-multi-step-pipeline]]"
  - "[[../01-pm/decisions/0022-character-rendering]]"
provenance: extracted
---

# TM-135 — 생성 품질 RCA + 개선 로드맵

## TL;DR (Executive)

사용자가 보고한 "곰돌이 → 갈색 원" 회귀를 라이브 재현 완료. **단일 결정적 원인은 없고 5개 축이 누적된 결과**지만, **가장 큰 단일 결함은 TM-90 asset-gen 통합이 multi-step 파이프라인 안에만 배선되어 있고 — 그 multi-step은 (a) `AI_MULTI_STEP=1` 미설정으로 prod에서 항상 off (TM-124 확인) AND (b) `!opts.answers` 가드로 인해 clarify 답변이 들어오면 여전히 single-shot으로 빠지기 때문에 — 결과적으로 살아있는-개체(living-entity) 프롬프트는 100% asset-gen을 우회한다는 것**이다. 즉 ADR-0022의 핵심 제안(image-gen 우선 hybrid)이 **코드는 있지만 실행 경로는 사하나도 없는 dead code 상태**.

세부 5축:
1. **System prompt** — visual richness 강제가 약함. "캐릭터를 그려라"는 있지만 "분리된 사지(legs)/머리/얼굴" 같은 구조적 요구사항 없음. data-viz·transition·text-anim·loader·infographic는 자세한 카테고리별 가이드가 있지만 **character/scene 카테고리는 0**.
2. **Reasoning depth** — single-shot이 default. multi-step도 outline이 1-scene으로 항상 collapse(TM-124 r1에서 5/5 확인). reflection / self-critique 루프 부재.
3. **Validation** — sandbox·skeleton 검사만 운영. visual quality judge(TM-66/100/111)는 bench 용으로만 호출되고 generate 경로에는 hook 0건.
4. **Capability** — 순수 Remotion 코드만으로 캐릭터 충실 렌더는 불가(ADR-0022가 1년 전 인지). image-gen(TM-84/90)으로 보조하기로 결정했지만 위 (1)·(2)의 라우팅 결함으로 실제로 호출되지 않음. Lottie / SVG path animation / sprite sheet 같은 alternative capability도 0개 통합.
5. **Iteration UX** — 사용자가 결과를 본 뒤 "다시 시도"가 유일한 escape. preview-then-confirm·variant generation·"better-of-N" 패턴 모두 부재.

권고: **즉시(1주차)** 2건 + **중기(1개월)** 3건 + **장기(분기)** 3건, 총 8건의 후속 task spawn. 가장 ROI 높은 단일 fix는 **`generate.ts:383`의 `!opts.answers` 가드 제거 + asset-gen을 single-shot 경로에도 배선** (코드 ~30줄, prod에 즉시 곰돌이 PNG가 나옴).

---

## Phase A — 사용자 시나리오 라이브 재현

### A.1 환경

- worktree: `worktrees/TM-135-quality-research` (HEAD `8a91edb`)
- dev server: `localhost:3135` (Next.js 16.2.4 / Turbopack)
- 환경 변수: `OPENAI_API_KEY=set`, `AI_MULTI_STEP=unset` (= prod default), `DEV_AUTO_LOGIN=true`
- 모델: `gpt-4o` (PRO tier)

### A.2 1차 호출 — 사용자 원본 프롬프트

```bash
POST /api/generate
{ "prompt": "곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘" }
```

**응답 (HTTP 200, 7.6s 벽시계)**:

```json
{
  "type": "clarify",
  "questions": [
    { "id": "bear_style",        "question": "곰돌이의 스타일은?",      "choices": ["사실적", "만화", "귀여운"] },
    { "id": "background_detail", "question": "초원의 배경 디테일은?",   "choices": ["단순", "상세", "판타지"] },
    { "id": "color_palette",     "question": "색감은?",                  "choices": ["따뜻한", "차가운", "비비드"] },
    { "id": "music_mood",        "question": "배경 음악의 분위기는?",   "choices": ["잔잔", "명랑", "모험적"] }
  ]
}
```

→ TM-95 living-entity narrow rule (`/(곰돌이|강아지|...)/`)이 정확히 trigger. **여기까지는 의도대로 동작.**

### A.3 2차 호출 — clarify 답변 후 generate

```json
{ "prompt": "...", "answers": { "bear_style":"cartoon","background_detail":"detailed","color_palette":"warm","music_mood":"cheerful" } }
```

**응답 (HTTP 200, 6.2s 벽시계)**:

```json
{
  "type": "generate",
  "asset": { "title": "Cartoon Bear Walking in Meadow", "durationInFrames": 300, "fps": 30, "width": 1920, "height": 1080 },
  "assetGenStages": {
    "mode": "single-shot",
    "stages": [{ "name":"single-shot", "ms":6204, "meta":{"firstTokenMs":1052} }],
    "totalMs": 6204,
    "asset_gen_used": false,   // ← 핵심
    "scenes": 0
  }
}
```

**생성된 코드 (전문)**:

```tsx
const PARAMS = {
  bearColor: "#D2691E", // type: color
  meadowColor: "#98FB98", // type: color
  skyColor: "#87CEEB", // type: color
  speed: 1.0, // type: range, min: 0.1, max: 3.0
  bgmTrack: "audio/upbeat-runner.mp3", // type: bgmTrack
  bgmVolume: 0.6, // type: number, min: 0, max: 1, step: 0.05
} as const;

export const GeneratedAsset = ({ /* ...spread defaults */ }: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const bearPosition = interpolate(frame * speed, [0, durationInFrames], [0, width]);
  return (
    <AbsoluteFill style={{ backgroundColor: skyColor }}>
      <CatalogueAudio track={bgmTrack} volume={bgmVolume} />
      <div style={{ position:'absolute', bottom:0, width:'100%', height:'50%', backgroundColor: meadowColor }} />
      <div style={{
        position:'absolute', bottom:'25%', left: bearPosition,
        width:100, height:100, backgroundColor: bearColor, borderRadius:'50%',
        boxShadow:'0 0 10px rgba(0,0,0,0.5)'
      }} />
    </AbsoluteFill>
  );
};
```

**관찰**: 갈색 원(`#D2691E borderRadius:50%`)이 평지(connected: 평면 div) 위를 가로지르며 이동. **다리·머리·귀·얼굴·걸음 사이클 모두 0**. 사용자 보고와 정확히 일치.

### A.4 즉시 진단

| 신호 | 관측 |
|---|---|
| `asset_gen_used` | **false** — gpt-image-1 PNG 한 번도 생성되지 않음 |
| `mode` | `single-shot` (TM-124 확인 그대로 prod default) |
| `scenes` | 0 (multi-step 미실행) |
| `public/uploads/asset-gen/` | 디렉터리 비어있음 (이 worktree 생애 한 번도 hit X) |
| 코드 길이 | 1326 chars (placeholder guard ≥200은 통과) |
| visual judge 호출 여부 | **0** (generate 경로에 hook 없음) |

### A.5 코드 경로 추적 — 왜 asset-gen이 안 fire 했나

`src/lib/ai/generate.ts:383`:
```ts
if (process.env.AI_MULTI_STEP === '1' && !opts.answers) {
  const { generateAssetMultiStepAsApiResponse } = await import('./pipeline');
  return await generateAssetMultiStepAsApiResponse(prompt, model);
}
```

조건이 둘 다 false:
- `AI_MULTI_STEP === '1'`: prod 미설정 → false (TM-124에서 확인)
- `!opts.answers`: 우리는 clarify 답변을 보냄 → false (둘째 라운드)

**결정적 카운터팩추얼**: 가령 `AI_MULTI_STEP=1`을 켰더라도 living-entity 프롬프트는 1차에 clarify로 빠지므로 2차는 항상 `opts.answers`가 truthy → 여전히 multi-step 통과 못 함. **즉, asset-gen은 living-entity 프롬프트에 대해 production code path 상으로 영원히 도달 불가.**

이는 ADR-0022의 의도("character / animal / person 프롬프트에 한해 image-gen 활성")와 정확히 정반대. asset-gen은 데드코드.

---

## Phase B — 외부 리서치

### B.1 Claude Artifacts / v0 / Bolt 비교

[2026 비교 자료](https://pasqualepillitteri.it/en/news/591/ai-app-builders-comparison-2026)에 따르면:
- **Claude Artifacts**: React/SVG/Mermaid를 sandbox에서 즉시 렌더. 인터랙티브 차트·애니메이션 다이어그램은 강함. 하지만 비디오 도메인(Remotion 같은 frame-based 합성)은 native 지원 X.
- **v0.dev**: UI-centric, React/Next.js/Tailwind 강세. 애니메이션 코드는 Framer Motion/CSS 위주. 캐릭터 일러스트는 drawback (사용자 첨부 이미지 의존).
- **Bolt.new**: full-stack scaffold. 비디오 도메인 약함.

핵심 인사이트: **이들 도구의 우위는 LLM 자체가 아니라 (a) 실시간 프리뷰 + 즉시 수정 루프 + (b) 시각 결과를 본 뒤 LLM에 fed-back하는 reflection 루프(특히 v0의 design history)에 있음**. 우리 EasyMake는 (a)는 있고 (b)는 없음.

EasyMake가 Claude Artifacts·v0보다 못해 보이는 진짜 이유는:
1. 첫 generate가 6s만에 끝나서 reasoning depth가 얕음 (single-shot).
2. 시각 결과를 LLM이 못 봄 → 갈색 원이 곰돌이로 렌더된 이상한 결과를 LLM이 알 수 없음.
3. Claude Artifacts는 사용자가 "더 자세히 그려줘"라고 자연스럽게 말할 수 있는 chat UX. EasyMake는 "edit" 모드가 PARAMS 변경에 최적화되어 있어 "캐릭터 자체를 다시 그려" 같은 거시 변경은 첫 generate를 다시 돌리는 것과 같음.

### B.2 Remotion 생태계 quality 패턴

Remotion docs MCP 조회 결과:
- **`@remotion/lottie`**: Lottie 애니메이션 임베드. **곰돌이 같은 캐릭터 walk-cycle은 LottieFiles에 무료 자산 수천 개 존재** (CC-BY 또는 public domain). EasyMake에서 미사용.
- **`@remotion/paths`**: SVG path utilities (interpolatePath, evolvePath, getPointAtLength, warpPath). 캐릭터를 SVG path로 표현하면 morph·tangent 따라 motion이 가능. 미사용.
- **`<AbsoluteFill>` 레이어 합성 패턴**: foreground/midground/background 분리가 표준 Remotion 관용구. 시스템 프롬프트가 이 패턴을 명시 안 함 → LLM이 위처럼 단일 평면으로만 그림.
- **community templates**: [reactvideoeditor/remotion-templates](https://github.com/reactvideoeditor/remotion-templates) (81 템플릿), [stefanwittwer/remotion-animated](https://github.com/stefanwittwer/remotion-animated). 캐릭터 walk cycle 전용은 적지만, parallax background + 레이어드 scene은 풍부.
- **신규 deps 후보**: `lottie-web` + `@remotion/lottie` (LottieFiles 무료 자산), `framer-motion` (이미 React 생태계 표준), `anime.js` (timing engine).

### B.3 Generative video 도구 (text-to-video API) — hybrid 옵션

[2026년 5월 기준 비교](https://wavespeed.ai/blog/posts/best-text-to-video-api-2026/):

| 모델 | 캐릭터 motion 강점 | API 가격 | 1080p 5초 가격 | 우리 시나리오 적합도 |
|---|---|---|---|---|
| **Runway Gen-4.5** | Top Elo 1247, 일관된 캐릭터 (single-ref image), prompt adherence 강 | API 있음 | ~$0.50–1.00 | ★★★ — 곰돌이 walk-cycle 직접 가능 |
| **Kling 3.0** | "ultra-realistic human motion", reference still 기반 | API 있음 (Kuaishou) | ~$0.30–0.80 | ★★★ — 캐릭터 한정 best |
| **Luma Dream Machine** | natural motion, 720p free | API 있음 ($7.99~) | ~$0.20–0.50 | ★★ |
| **Sora 2** | OpenAI 생태계 | **2026-04-26 부터 product 단종** API만 잔존 | ~$0.40–0.80 | ★★ — 정책 리스크 |
| **Pika 2** | 짧은 클립, "fancy" 모드 | $8~$76/월 | credit-based | ★ |

핵심 한계: 모두 latency 30s–2min, 비용은 image-gen($0.04)보다 10–25× 높음, 그리고 **결정적: 결과는 mp4/webm — 우리 PARAMS 자동 추출(ADR-0002), edit-only-with-LLM(ADR-0001), customize UI 모두 적용 불가**. 비디오는 PARAMS가 없음.

→ **권고 (장기)**: text-to-video는 "곰돌이 자체"를 video clip으로 만든 뒤 Remotion에서 텍스트·UI 오버레이만 합성하는 hybrid. 그러나 ADR-0001 (edit ≠ render) 깨짐 → 별도 ADR 필요. 단기 우선순위는 아님.

### B.4 Image-gen + frame composition (현재 ADR-0022 path 확장)

옵션 정리:
- **A. 단일 PNG (현 TM-90)**: 정적 이미지 위에 transform 만 가능. 걸음 사이클 X. — 현재 디자인.
- **B. Sprite sheet generation**: gpt-image-1으로 walk1.png, walk2.png, walk3.png, walk4.png를 4번 호출 후 frame-cycled으로 표시. 비용 $0.16, latency 40s. 진짜 walk-cycle 구현 가능.
- **C. Multi-pose batch**: idle/walk/jump pose 각 1장 + Remotion sequence로 시나리오 분기. 비용 $0.08–$0.16.
- **D. Lottie 합성 (B.2와 결합)**: 무료 LottieFiles 캐릭터 + image-gen으로 배경만 생성 → 캐릭터는 walk-cycle 보장. 비용 $0.04 + 0.
- **E. SVG path-based skeleton**: `@remotion/paths`로 곰돌이 윤곽 path를 LLM이 묘사 → `interpolatePath`로 walk frame 보간. 외부 비용 $0, but LLM에게 SVG 골격 그리기를 시키는 건 신뢰도 매우 낮음 (ADR-0022 옵션 C가 거부한 이유).

권고 우선순위: **D > C > B > A > E**. D는 무료 자산 카탈로그 + 즉시 walk cycle, C는 ADR-0022 자연 확장, B는 단순한 진화.

### B.5 검증 추론 파이프 강화 — Reasoning + Self-critique 패턴

검색 ([self-refine 2303.17651](https://arxiv.org/abs/2303.17651), [RefineCoder 2502.09183](https://arxiv.org/abs/2502.09183), Vision-Guided 2604.05839):

| 패턴 | 우리 적용처 | 추정 uplift | 비용 multiplier |
|---|---|---|---|
| **Self-Refine (Madaan 2023)**: generate → self-critique → refine, N회 | scene-code 단계에 1 round | ~+15–20% (논문 평균) | ~1.5–2× |
| **RefineCoder (ACR 2025)**: code → LLM-judge score → critique → revised code | generate.ts 후 1 round | +pass@1 5–10% | ~2× |
| **Vision-Guided (Critic-in-the-loop)**: vision-LM이 렌더 결과 보고 피드백 | **TM-66 visual judge를 generate 경로에 hook**, 3 cycle 루프 | +17.8% (논문) | 3× round-trip |
| **Best-of-N + LLM-judge**: N개 후보 generate → judge가 best 선택 | 비용 N× LLM, but quality 단조 증가 | N=3에서 +20% | 3× |
| **Multi-model ensemble**: gpt-4o + claude-opus + judge | "어느 한 모델 실패 시" 회복 | 변동 | 2–3× |
| **Reflexion (verbal reinforcement)**: 실패 후 자연어 메모 → 다음 시도 | reasoning 파이프에 메모리 추가 | +5–15% | +20% |

핵심 인사이트: **Vision-Guided Iterative Refinement**(2026)는 우리 시나리오에 거의 맞춤. TM-66/100/111의 visual judge 인프라(이미 작동, gpt-4o 멀티모달)를 generate 경로에 hook하면 갈색 원 → "이건 곰돌이가 아니라 원이다, legs 추가, head 분리, 표정 추가 해라" 피드백을 LLM에 다시 줄 수 있음.

---

## Phase C — RCA (5축 평가)

| 축 | 점수 (1=치명, 5=양호) | 회귀 기여도 (정성) | 핵심 결함 |
|---|---|---|---|
| **1. Prompt engineering** | 2 | 30% | system prompt에 character/scene 카테고리 가이드 0건. data-viz/transition/text-anim 등 5개는 자세하지만 캐릭터는 비어 있어 LLM이 "원으로 곰돌이 표현" 같은 단순화에 brake가 없음. visual structure rubric(foreground/midground/background, 분리된 사지) 미강제. |
| **2. Reasoning depth** | 2 | 25% | single-shot이 default(TM-124 확인). multi-step도 outline이 1-scene으로 collapse(TM-124 retro). multi-scene 강제·self-critique 부재. |
| **3. Validation** | 1 | 20% | sandbox·skeleton·placeholder 검사만. visual judge(TM-66/100/111) 인프라는 있지만 generate 경로에 0 hook. "갈색 원이 곰돌이로 의도되었는가"를 절대 검증 안 함. |
| **4. Capability** | 1 | 25% | **dead-code asset-gen** (위 A.5). 코드 ~230줄(asset-gen-stage.ts) + 230줄(pipeline asset-gen 분기) + 4 tests = 약 700줄이 단 한 번도 user-facing path에서 실행되지 않음. ADR-0022 의도 100% 무효화. Lottie/sprite-sheet 등 alternative capability 0건. |
| **5. Iteration UX** | 3 | "추가 원인" | edit는 PARAMS 변경에 최적화. "캐릭터 자체 재생성" UX는 first-generate 재시도와 동일. preview-and-confirm·variant generation 부재. |

**합계 11/25** (44%). 상태 = critical capability gap.

### 회귀의 인과 사슬 (단일 path)

```
사용자 prompt "곰돌이가 초원..."
  → TM-95 narrow rule trigger → mode=clarify (의도대로)
  → 사용자 4개 답변 → POST 두 번째에 opts.answers 채워짐
  → generate.ts:383 가드: AI_MULTI_STEP=1? NO → multi-step skip
                       그리고 !opts.answers? NO → multi-step skip (이중)
  → single-shot generation (gpt-4o) 실행
    → system prompt에 "캐릭터 가이드" 없음 → LLM이 가장 단순한 "원 + 평면" 해석
    → asset-gen 미실행 (single-shot 경로엔 asset-gen 배선 없음)
  → 응답 검증: code 길이 ≥200? OK. PARAMS 존재? OK. JSX 존재? OK. → PASS
  → visual judge 호출? 0건. → PASS
  → 사용자에게 갈색 원 전송
```

**가장 작은 fix로 가장 큰 효과**: 위 가드 한 줄(`!opts.answers` 제거) + asset-gen을 single-shot 경로에도 호출 = 갈색 원 → 만화 곰돌이 PNG가 walk path를 따라 이동. ~30줄 변경, 추가 비용 +$0.04/generate(첫 생성만, 캐시 적중 시 $0).

---

## Phase D — 개선안 (8건, ROI 매트릭스)

| ID | 제목 | 기대 uplift | 구현 비용 | 추가 비용/asset | 우선순위 | 의존 |
|---|---|---|---|---|---|---|
| **D1** | **(즉시) asset-gen을 single-shot 경로에 배선 + `!opts.answers` 가드 제거** | ★★★★★ (single biggest fix) | S (~30 LOC + tests) | +$0.04/첫 생성 | **P0** | 없음 |
| **D2** | **(즉시) system prompt — character/scene 카테고리 가이드 추가** (foreground/midground/background, 분리된 사지, 표정, walk-cycle keyframe 패턴) | ★★★ | S (~80 LOC prompt) | $0 | **P0** | 없음 |
| D3 | (중기) **Vision-guided self-critique loop** — TM-66 visual judge를 generate 경로에 hook, 1-cycle: generate → judge → "improvements" prompt → regenerate | ★★★★ | M (~200 LOC + judge tuning) | +1× LLM call (~$0.005) + 1× judge ($0.001) | **P1** | TM-66, D1 |
| D4 | (중기) **multi-step default ON for character prompts** + outline에 "≥2 scenes" 강제 | ★★★ | M (~100 LOC + bench) | +0.4× LLM cost (TM-124 ratio) | **P1** | TM-124 finding |
| D5 | (중기) **Lottie 카탈로그 통합 (B.4 옵션 D)** — LottieFiles 무료 walk-cycle 자산 ~30개 큐레이션 → RAG로 prompt-to-asset 매칭 | ★★★★ | L (~300 LOC + 자산 수급) | $0 (정적) | **P1** | TM-74 RAG, ADR 신규 |
| D6 | (중기) **Reference-based generation (RAG 확장)** — TM-74 retrieval에 community templates 추가, "similar prompt" template를 LLM에 reference로 제공 | ★★★ | M (~150 LOC + corpus) | +200 prompt tokens | P2 | TM-74 |
| D7 | (장기) **Sprite sheet pipeline (B.4 옵션 B)** — gpt-image-1으로 walk1..4.png 4-frame 생성 + Remotion sprite animator | ★★★★ | L (~400 LOC + 실험) | +$0.16/첫 생성 | P2 | D1 |
| D8 | (장기) **text-to-video hybrid (B.3)** — Runway Gen-4.5 API로 캐릭터 motion만 생성 → Remotion에서 텍스트/UI 오버레이 합성 | ★★★★★ | XL (~1000 LOC + 신규 ADR + UX) | +$0.50/첫 생성 | P3 | 신규 ADR (ADR-0001 충돌) |

**Impact × Cost 매트릭스**:

```
HIGH impact ┃  D5  D8        D1
            ┃  D7  D3        D2
            ┃        D4
            ┃  D6
LOW  impact ┃
            ┗━━━━━━━━━━━━━━━━━━━━━━
              HIGH cost   LOW cost
```

**즉시 실행 권고**: **D1 + D2를 같은 PR로**. D1만으로도 곰돌이 PNG가 출력되어 사용자 perception이 극적으로 변화. D2는 PNG가 없는 경우(작은 변경 후 sandbox 통과 못 한 fallback 등)에도 baseline quality 상승. 두 변경 합쳐 ~110 LOC + 1 PR.

다음 1-2주: **D3 (visual judge hook)**. 인프라(TM-66 multimodal judge, TM-100 ai-quality-judge agent definition)가 이미 있으니 hook 추가만 필요. self-critique 1-cycle은 비용 +$0.006이고 latency +6s지만 quality uplift 17.8% (vision-guided 논문 보수 추정).

---

## Phase E — 즉시 실행 가능 권고 (1-2건)

### E.1 권고 #1 (P0, 30분 작업): asset-gen single-shot 배선

**파일**: `src/lib/ai/generate.ts:383` 부근 + `src/app/api/generate/route.ts:96` 부근

**의사코드**:
```ts
// generate.ts — single-shot 본체 직전, opts.answers 들어왔든 안 들어왔든:
if (process.env.AI_MULTI_STEP !== '0') {           // 명시 off가 아닌 한
  const { runAssetGenStage } = await import('./asset-gen-stage');
  // living-entity 감지 + image-gen (cached이면 0원)
  const assetGen = await runAssetGenStage({ prompt, answers: opts.answers })
    .catch(() => null);
  if (assetGen) {
    // single-shot system prompt에 "imageUrl 있음, <Img src> 활용하라" 한 줄 추가
    // 응답 후 PARAMS에 imageUrl 합성 (composeSceneCodes의 imageUrlField와 동일 패턴)
  }
}
```

테스트: `__tests__/lib/ai/asset-gen-stage.test.ts` 22개 (이미 존재) + single-shot wiring 통합 테스트 1건 추가.

리스크: prod에서 living-entity 프롬프트 첫 generate 시 +$0.04, +25–40s latency (TM-90 측정). 캐시 적중 후 $0/0s. 사용자 첫 응답이 느려지므로 progressive UI 필요(별도 task).

### E.2 권고 #2 (P0, 1시간 작업): system prompt character 가이드

`src/lib/ai/prompts.ts` `GENERATION_SYSTEM_PROMPT`의 `CATEGORY-SPECIFIC GUIDELINES` 블록에 **`[CHARACTER / SCENE / NARRATIVE — bear/dog/person/animal subject]`** 섹션 추가:

핵심 강제 항목:
- foreground (캐릭터) / midground (배경 디테일) / background (sky/gradient) 3-layer composition 강제. 단일 평면 div는 FAILURE.
- 살아있는-개체는 **절대로 단일 원/사각형으로 표현 금지**. 분리된 head + body + 4 limbs (또는 2 limbs + tail) + face features (eyes/nose/mouth) 최소 요구.
- walk cycle: 다리는 frame 함수로 phase-shifted 진동(`Math.sin((frame + phase) * 0.2)`). 정지 + translateX는 walking이 아님 — FAILURE.
- 횡스크롤/parallax: 배경 elements는 캐릭터보다 0.3–0.5× 속도로 반대 방향 이동. 정적 배경은 horizontal scroll 효과를 못 줌.
- 만약 PARAMS.imageUrl이 (TM-90 asset-gen에서) 제공되면 캐릭터를 vector 그리지 말고 `<Img src={imageUrl} />`로 대체.

추정 +80 LOC prompt. 캐시 키 안정 (cache_control: ephemeral은 prepend된 시스템 프롬프트 전체를 한 청크로 캐시하므로 한 번 fed 후 동일 시스템 프롬프트는 caching 된다).

**검증**: TM-46 corpus + 새 character corpus 5건(곰돌이/강아지/사람/우주인/공주)으로 재실행. visual judge mean score uplift 측정. 목표: pre-fix mean ~50/100 → post-fix ≥70/100.

---

## Phase F — Spawn 권고 (8건)

```
TM-135-spawn-1: D1 — asset-gen을 single-shot 경로 배선 + `!opts.answers` 가드 제거         (P0, 즉시)
TM-135-spawn-2: D2 — system prompt CHARACTER/SCENE 카테고리 가이드 추가                       (P0, 즉시)
TM-135-spawn-3: D3 — Vision-guided self-critique 1-cycle (TM-66 judge → improvements prompt) (P1, 1-2주)
TM-135-spawn-4: D4 — character 카테고리에 한해 multi-step default ON + outline ≥2 scene 강제   (P1, 1-2주)
TM-135-spawn-5: D5 — Lottie 카탈로그 통합 + RAG 매칭 (LottieFiles 30개 walk-cycle 자산)        (P1, 2-4주, 신규 ADR)
TM-135-spawn-6: D6 — RAG 확장: community Remotion templates corpus 추가                       (P2, 2-4주)
TM-135-spawn-7: D7 — sprite sheet pipeline (4-frame walk-cycle)                                (P2, 1개월)
TM-135-spawn-8: D8 — text-to-video hybrid (Runway/Kling) — 별도 ADR                            (P3, 분기)
```

각 task placeholder ID로 spawn (PR Phase에서 실제 TM-NNN 부여 또는 .taskmaster JSON 추가).

---

## 출처 / 링크

### 사내
- [[2026-05-13-TM-90-asset-gen-integration]] — TM-90 asset-gen integration (현재 dead-code인 줄 모르고 작성됨)
- [[2026-05-14-TM-124-timing]] — multi-step이 prod default off임을 확인한 timing report
- [[2026-05-13-TM-85-pipeline-quality]] — 30-prompt acceptance bench (data-viz over-clarify 회귀)
- [[../01-pm/decisions/0020-multi-step-pipeline]] — ADR-0020 (multi-step의 cost/uplift trade-off)
- [[../01-pm/decisions/0022-character-rendering]] — ADR-0022 (image-gen 우선 hybrid 결정)

### 코드
- `src/lib/ai/generate.ts:383` — `AI_MULTI_STEP === '1' && !opts.answers` 가드 (D1 fix 위치)
- `src/lib/ai/asset-gen-stage.ts` — dead-code asset-gen wrapper
- `src/lib/ai/pipeline.ts:1024-1058` — multi-step 안에만 있는 asset-gen Promise.all
- `src/lib/ai/prompts.ts:170-228` — CATEGORY-SPECIFIC GUIDELINES (character 누락)
- `src/app/api/generate/route.ts:96-104` — single-shot 응답에 `asset_gen_used:false` hardcode

### 외부
- [Self-Refine arxiv 2303.17651](https://arxiv.org/abs/2303.17651) — iterative refinement baseline +20%
- [RefineCoder arxiv 2502.09183](https://arxiv.org/abs/2502.09183) — code-specific ACR 패턴
- [Vision-Guided Iterative Refinement arxiv 2604.05839](https://arxiv.org/html/2604.05839v1) — vision-critic-in-the-loop +17.8%
- [Remotion @lottie](https://www.remotion.dev/docs/lottie) — Lottie 통합 docs
- [Remotion @paths](https://www.remotion.dev/docs/paths) — SVG path utilities
- [Remotion Apple Wow tutorial](https://www.remotion.dev/learn/apple-wow) — 레이어드 합성 reference
- [reactvideoeditor/remotion-templates](https://github.com/reactvideoeditor/remotion-templates) — 81 community templates
- [WaveSpeed text-to-video API guide 2026](https://wavespeed.ai/blog/posts/best-text-to-video-api-2026/) — Runway/Kling/Luma/Sora API 가격
- [Claude Artifacts 2026 limitations](https://p0stman.com/guides/claude-artifacts-limitations) — 비교 baseline
