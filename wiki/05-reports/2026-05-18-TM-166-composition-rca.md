---
title: TM-166 RCA — composition 결함 (곰돌이 산책 asset)
created: 2026-05-18
updated: 2026-05-18
tags: [report, rca, asset-gen, composition, multi-step, tm-166]
status: active
report_type: incident
provenance: extracted
---

# TM-166 RCA — composition 결함 ("곰돌이의 초원 산책")

> User-blocking incident — generated composition mangles a perfectly good asset-gen PNG into
> an unrecognisable, off-screen mess with a purple bar and pink flower icons.
> Edits twice from the user did NOT fix it. Multi-step pipeline broke the asset at v0
> and edit stage is too narrow to repair the structural damage.

Linked evidence:
- `wiki/05-reports/screenshots/TM-166/asset-code.tsx` — full generated TSX (v2, the current asset.code, 4564 bytes)
- `wiki/05-reports/screenshots/TM-166/asset-parameters.json` — extracted PARAMS row
- `wiki/05-reports/screenshots/TM-166/bear-png.png` — asset-gen PNG (1024×1024, perfectly composed scene)

Asset: `cmpaspov70001dmhlu5co33bc` "Improved Scene with Bear Visibility" (1920×1080, 300 frames @ 30fps, 2 Sequence-stitched scenes).
User prompt history (3 versions, all degraded):
1. `곰돌이가 초원을 걸어가는 10초분량의 횡스크롤 애니메이션 만들어줘.` → original generate
2. `곰돌이도 보라색 띠에 가려져 안보이고…퀄리티가 이상한데 다시검토해서 제대로 나오게 해봐.` → edit 1
3. `곰돌이가 움직이지 않고, 하단에 이상한 보라색띠랑…횡스크롤이라고 한것은 슈퍼마리오와같은 애니메이션을 말한거라서…` → edit 2

After 2 explicit fix-it edits, the asset is **still broken in the same way**. This is not an
asset-gen problem — it's a code-gen + composition problem the edit path can't see.

---

## 1. Forensic teardown of the generated code

The asset has **2 scenes**, both `<AbsoluteFill>` rooted, stitched by:

```tsx
const GeneratedAsset = (_props: typeof PARAMS = PARAMS) => (
  <AbsoluteFill style={{ backgroundColor: "#0f0f17" }}>      {/* dark navy outer */}
    <Sequence from={0}   durationInFrames={150}><Scene1 /></Sequence>
    <Sequence from={150} durationInFrames={150}><Scene2 /></Sequence>
  </AbsoluteFill>
);
```

`PARAMS.imageUrl` IS present (auto-injected by `injectAssetImageUrl` in `src/lib/ai/generate.ts:480`), but **neither scene reads it from PARAMS** — Scene1 hard-codes the URL string, Scene2 references a bare `imageUrl` identifier that doesn't exist in its scope.

### 1.1 Scene1 (frames 0-149) — the "black 70% + purple bar + dancing flowers" bug

Z-order back→front (DOM order inside `AbsoluteFill`):

| Layer | Element | Where | Why broken |
|---|---|---|---|
| 0 | `AbsoluteFill bg #0f0f17` | full frame | dark navy — there is NO sky/ground layer above it, so any pixel not covered by the Img becomes the "black 70%" the user reports |
| 1 | `<Img src="…bear-png">` | `left=bearX (-200→300)`, **`top=340`**, **no width/height** | natural size = 1024×1024. With `top=340` and no clipping, the bottom row of the PNG is at y=1364 — **way below** the 1080 frame. The PNG IS the entire scene (sky+meadow+bear) but the model treats it as a sprite of the bear alone. Result: 60-70% of the canvas is the bare `#0f0f17` |
| 2 | solid `<div>` | `top=800`, full width, `height=200`, `bg=#7C3AED` | The "purple band covering half the bear" — a horizontal purple stripe over the PNG, mid-bear height |
| 3 | 3× `<lucide.Flower>` | `top=[820,830,810]`, `color=#F472B6` | Default lucide size = 24px, pink, scattered on top of the purple stripe. These are the "pink flower icons abnormally placed" |

The PNG already contains flowers, grass, hills, sky and the bear — the LLM bolted on a *second* set of decorative elements (purple band + pink lucide flowers) **on top of** a layer that was supposed to BE the full scene.

### 1.2 Scene2 (frames 150-299) — strictly worse

```tsx
<Img src={imageUrl} … />                                 // ReferenceError: imageUrl is undefined
<div … bg=scene1_primaryColor />                          // another purple bar at top=800
<lucide.Flowers … />                                      // <Unknown> — there is no `Flowers` export
<div … bg='#F472B6' opacity={sunlightOpacity} />          // full-screen pink overlay at 0.5-0.7
```

Three independent failures in 4 lines:
1. `imageUrl` (not `PARAMS.imageUrl`) crashes at render → `__SceneBoundary` (TM-116) catches it, replacing Scene2 with `transparent` (frames 150-299 are blank navy).
2. `lucide.Flowers` (plural) doesn't exist in `lucide-react` exports — the TM-118 hallucination scrub catches `<lucide.Icon name="…"/>` form but not invented PascalCase names. Renders as `<Unknown>` / nothing.
3. The last `<div>` is a **full-screen pink AbsoluteFill** at opacity 0.5+. Even if Scene2 weren't error-boundaried, this alone would smother the entire frame.

In other words: Scene2 was *already* a fatal crash; the user only "sees" Scene1's broken composition for the full 10 seconds because the boundary blanked Scene2.

### 1.3 Diagnosis summary

| User report | Real cause |
|---|---|
| "Black 70% of frame" | `AbsoluteFill bg #0f0f17` is the only thing under the bear PNG; PNG `top=340` with no `width`/clipping → ~60% of canvas is bare navy |
| "Purple solid box covers half the image" | LLM added a 200px-tall full-width `<div>` at `top=800` over the PNG, fed by `scene0_primaryColor=#7C3AED` from the outline palette |
| "Bear character missing" | Bear IS in the PNG; the PNG IS rendered; but it's positioned + cropped weirdly AND the purple band covers the lower half of the bear |
| "Pink lucide-flower icons scattered" | LLM added 3× `<lucide.Flower>` decoratively because the SCENE SPEC's `elements` list said "flowers" — model didn't realise the PNG already has flowers |
| "Composition code completely broken" | Bare `imageUrl` ref + nonexistent `lucide.Flowers` + full-frame pink overlay = Scene2 throws and renders as blank |

---

## 2. Five-axis RCA

### Axis 1 — System prompt: the multi-step `SCENE_CODE_SYSTEM_PROMPT` is missing the CHARACTER guidelines

This is the **root cause of the composition mess**.

The single-shot `GENERATION_SYSTEM_PROMPT` (`src/lib/ai/prompts.ts:20–396`) has 64 lines of CHARACTER/SCENE/NARRATIVE guidance (lines 310–374):
- "If PARAMS exposes `imageUrl`, render via `<Img src={imageUrl} … />` instead of vector-drawing it; **still apply the bobY + scene-depth + parallax pattern around the image**"
- Anti-pattern list including "single circle/square/pill as character", "flat one-layer scene", "monochrome scene"
- 3-layer composition rule (background/midground/foreground)

But the multi-step path's `SCENE_CODE_SYSTEM_PROMPT` (`prompts.ts:736–769`) is **34 lines and contains ZERO CHARACTER guidance**. The only image-asset hint is a one-line addendum injected at `pipeline.ts:714–720`:

> "If the scene's narrativeBeat features that subject, render it via `<Img src={imageUrl} style={{ width, height, objectFit: 'contain' }} />` (absolute-positioned inside the AbsoluteFill) and animate position/scale/opacity around it instead of drawing a vector approximation."

This addendum does NOT say:
- Treat the PNG as the FULL scene background (it can contain sky, ground, character)
- Do NOT add colored AbsoluteFill or solid bands over the PNG
- Do NOT add lucide decoration on top of subject-bearing imagery
- The PNG already provides background + midground + foreground; layer additional motion as transforms on the Img layer, not as new full-frame solids

The multi-step pipeline routes living-entity prompts (TM-95 path) here because the asset is "complex" — the **most demanding composition** runs through the **weakest prompt**.

### Axis 2 — PARAMS misuse: `imageUrl` is not consistently read via PARAMS

`injectAssetImageUrl()` back-fills `PARAMS.imageUrl` at the wrapper level (`pipeline.ts:954`), but per-scene fragments are written before the wrapper exists, and the SCENE_CODE_SYSTEM_PROMPT does NOT instruct: "you may reference `PARAMS.imageUrl` via destructured props". Scene1 hard-codes the URL string (works but uneditable); Scene2 references a bare `imageUrl` identifier expecting it to be a closure variable — **ReferenceError at runtime**.

There is no validator step that confirms every `<Img src={X}/>` in a scene fragment resolves to either a literal string, a destructured prop default, or `PARAMS.imageUrl`.

### Axis 3 — Layout chaos: nothing enforces "no opaque full-frame block above subject image"

The validator (`sanitizeForbiddenTokens`, `validateCode`) catches require()/globalThis/dynamic import — **not** structural composition errors. There is no AST check for:
- A solid-colored `<AbsoluteFill>` or full-frame `<div>` placed AFTER an `<Img>` in DOM order (z-above) with no children, no opacity bound to motion, no mask
- A `<div>` with `width:'100%'` and large `height` placed inside a scene that also contains a subject `<Img>`
- More than 1 child of `AbsoluteFill` whose `backgroundColor` is in the outline palette (signals palette-block hallucination)

A 20-line AST pass on the assembled module could catch this entire class of failures.

### Axis 4 — self-critique judges the PNG, not the composition

`self-critique.ts:152` calls `judgeVisual` with `image_url = the asset-gen PNG`. The judge sees the lovely bear-in-meadow PNG → scores high → no retry. The composition that USES the PNG is **never visually judged** before save.

This is an ADR-0001 consequence: "edit ≠ render", server-side Remotion renders are forbidden on the generate path. But that doesn't mean we can't judge a **headless React snapshot** — `@react/server`/jsdom or a one-off Puppeteer hit on `/preview/<assetId>?frame=75` would give us a single frame to feed `judgeVisual` against composition criteria. TM-138 explicitly leaves this gap.

### Axis 5 — codegen↔composition gap: LLM treats scene elements as **additions**, not as a **complete** picture

The pipeline's stage 2 (`SCENE_SPEC_SYSTEM_PROMPT`) asks the LLM to enumerate "elements" (kind: bar/circle/rect/icon/line/sparkle/text/chart). When the user prompt is "곰돌이가 초원을 걸어간다", the spec stage outputs:

```
elements: [
  { kind: 'icon', label: 'flowers', … },
  { kind: 'rect', label: 'ground band', … },
  { kind: 'circle', label: 'sun', … }
]
```

The code stage then **dutifully renders every element**, on top of the PNG, without realising the PNG already contains flowers, ground, sky. The spec stage has no awareness that an `imageUrl` will be available — the spec is written **before** asset-gen runs (or, when asset-gen runs first, the spec stage isn't told "the meadow + bear are already drawn for you, only add motion / camera"). This is the **structural** gap: spec and PNG are produced independently and stitched without negotiation.

---

## 3. External comparison / Remotion convention

Remotion's official composition pattern for full-bleed background imagery:

```tsx
<AbsoluteFill>
  <Img src={bgUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
  {/* motion layer ABOVE bg, ALWAYS transparent or partial */}
  <AbsoluteFill style={{ transform: `translateX(${parallaxX}px)` }}>
    {/* decorative SVG, captions, etc — never opaque full-bleed */}
  </AbsoluteFill>
</AbsoluteFill>
```

Two invariants the model violated:
1. `objectFit: 'cover'` on the bg `<Img>` — without it, a 1024×1024 PNG on a 1920×1080 canvas leaves bars.
2. Any layer above the bg must be **transparent or partially-opaque** unless it's intentionally a wipe/transition (and then only briefly). A solid 200px purple band over a subject is never correct.

Claude.ai's artifacts implementation of the same prompt would produce a horizontal-scrolling background (the "Mario-style" camera the user requested in edit-2) with the bear as a foreground sprite. Our pipeline doesn't model "camera" at all — it animates the bear's `left` but the background is static, which is why the user keeps saying "곰돌이가 움직이지 않고".

---

## 4. Why the edits didn't fix it

`EDIT_SYSTEM_PROMPT` (`prompts.ts:771`) enforces **PARAMS ISOLATION GUARD** (ADR-0023): change only the minimal set of keys the user explicitly named. The user's edit-1/2 requests describe a **structural** problem ("곰돌이가 보라색 띠에 가려져 안 보임"), but the edit prompt doesn't reference any PARAMS key — so the model conservatively touches small things (e.g. `top: 540 → 340` between v1 and v2, which is the ONLY diff). The structural bug (purple `<div>` band, missing width on `<Img>`, bare `imageUrl` ref in Scene2) is untouched because the edit path has no "regenerate scene" or "fix composition" mode.

This means edit-path triage will NEVER recover from a structurally broken initial gen. The remedy must be at the **generation** stage.

---

## 5. Proposed improvements (Phase E — task spawn candidates)

Priority ranking by ETA / impact:

| # | Title | Why | Touches | Impact | ETA |
|---|---|---|---|---|---|
| 1 | **Inline CHARACTER guidelines into `SCENE_CODE_SYSTEM_PROMPT`** | Axis 1 root cause. Multi-step path is missing the rules single-shot has. | `src/lib/ai/prompts.ts:736-769` (+ `pipeline.ts:714-720`) | HIGH — fixes ~80% of this class | S |
| 2 | **Strengthen `imageUrl` rule: "PNG is the FULL scene; do NOT add opaque AbsoluteFill or solid bands above it; motion = transforms on a sibling layer, never an opaque overlay"** | Directly addresses purple-band + pink-overlay + lucide-flower additions | `pipeline.ts` addendum + `prompts.ts` CHARACTER block | HIGH | S |
| 3 | **Validator AST rule: reject scene fragment that has `<Img>` + a later sibling `<div>`/`<AbsoluteFill>` with `backgroundColor` + no children + no animated opacity reaching 0** | Catches the exact failure mode structurally | new file `src/lib/code/composition-lint.ts` + hook into `validateCode` | HIGH (deterministic) | M |
| 4 | **Validator: `<Img src={…}>` must reference a literal string OR `PARAMS.imageUrl` OR a destructured prop** | Catches Scene2's bare-`imageUrl` ReferenceError before render | `src/lib/code/sandbox.ts` (or wherever `validateCode` lives) | MED | S |
| 5 | **Composition judge: render asset to 1 frame (frame 75 mid-scene1) via headless React snapshot, feed `judgeVisual` with criteria "no solid block covers ≥15% of frame; subject visible; ≤2 distinct non-transparent layers"** | Closes Axis 4 — currently only the PNG is judged, never the composition | new `src/lib/ai/composition-critique.ts`, runs in `generate.ts` post-assemble | HIGH (catches what code-lint misses) | L |
| 6 | **Spec↔asset-gen handshake: when `imageUrl` is being produced for this asset, modify the `SCENE_SPEC_SYSTEM_PROMPT` user payload to say "an image already contains: <subject, background, ground, decoration>; do NOT enumerate those as new elements"** | Axis 5 — stops the spec stage from listing flowers/ground that are already drawn | `pipeline.ts:scene-spec call site` | MED | M |
| 7 | **Hallucinated lucide names → catch `<lucide.X>` where X ∉ lucide-react exports; rewrite to nearest match (TM-118 v2)** | `lucide.Flowers` (plural) slipped through; same class as TM-118 | `pipeline.ts:189-241` extend | LOW (cosmetic; covered by #3 anyway) | S |
| 8 | **Asset-preview regression corpus: add TM-149 case for "곰돌이 초원 산책" + 5 similar character-scene prompts; auto-snapshot + judge-based pass/fail on every PR touching `prompts.ts`/`pipeline.ts`** | Prevents regression of this class | `__tests__/asset-preview/`, CI job | HIGH (catches future drift) | L |
| 9 | **Edit-path escape hatch: when user message contains structural-fix verbs ("다시 만들어", "퀄리티 이상", "처음부터", "구조가 깨졌") + the PARAMS-isolation guard would block meaningful change, switch to FULL_REGEN mode that re-runs scene-code with the original prompt + last critique** | This is why the user's edit-1/2 couldn't fix it | `src/lib/ai/edit.ts`, new gate in `pipeline.ts` | MED | M |
| 10 | **Mandatory `objectFit: 'cover'` on full-bleed `<Img>` (no width/height specified or both 100%)** — codegen lint that injects it if missing | Fixes "PNG only fills part of frame" symptom | composition-lint pass | LOW (cosmetic) | S |

**Recommended first wave (1 sprint): #1, #2, #3, #4** — pure prompt + deterministic validator, no new infra, fixes the user-reported symptoms immediately and re-runs of the same prompt will likely pass.

**Second wave: #5, #6, #8** — composition judging + spec/asset-gen handshake + regression corpus. These prevent the class from re-emerging when prompts mutate.

---

## 6. Verification plan after fixes

Re-run the original prompt through the pipeline with #1+#2+#3+#4 deployed:

```
prompt: "곰돌이가 초원을 걸어가는 10초분량의 횡스크롤 애니메이션 만들어줘."
expect:
  - PARAMS.imageUrl present
  - Scene1: <Img src={PARAMS.imageUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }}/> on bottom
  - foreground motion = transparent <div>/<svg> overlay (camera parallax)
  - NO opaque solid <div> above the Img
  - NO <lucide.Flower> decoration (PNG already has flowers)
  - Scene2 (if present): same pattern, references PARAMS.imageUrl explicitly
  - frame=75 snapshot: judge_visual.composition ≥ 70
```

Add this as a fixture in the asset-preview corpus (#8) so it stays fixed.

---

## 7. Cross-references

- ADR-0001 Edit ≠ Render — limits composition judging options (no server render); workaround = headless React snapshot
- ADR-0002 PARAMS auto-extract — `imageUrl` MUST be in PARAMS; Scene2 violates this with bare `imageUrl` ref
- ADR-0022 asset-gen + `imageUrl` PARAMS — surface contract is correct; the SCENE_CODE stage doesn't honour it
- TM-90 / TM-136 — `imageUrl` injection
- TM-137 — added CHARACTER guidelines to `GENERATION_SYSTEM_PROMPT`. **Did not propagate to `SCENE_CODE_SYSTEM_PROMPT`.** This is THE bug.
- TM-138 self-critique — judges asset-gen PNG only, NOT composition
- TM-116 `__SceneBoundary` — masks Scene2 crash so user sees only Scene1's mess (silent failure)
- TM-118 lucide hallucination scrub — catches `<lucide.Icon name="…"/>`, NOT `<lucide.Flowers>` (invented PascalCase)
- TM-149 asset-preview corpus — needs this case added

---

## 8. One-line summary for orchestrator

> `SCENE_CODE_SYSTEM_PROMPT` is missing the CHARACTER/SCENE composition rules that live in `GENERATION_SYSTEM_PROMPT`; multi-step path treats asset-gen PNG as a sprite and bolts decorative `<div>` bands + lucide icons on top; validator has no AST rule against opaque full-frame siblings above a subject `<Img>`; composition is never judged (only PNG is) — so the fix-it edits never see the structural bug. Spawn tasks #1–#4 immediately.
