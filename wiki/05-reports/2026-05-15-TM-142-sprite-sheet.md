---
title: "2026-05-15 — TM-142 sprite-sheet pipeline (4-frame walk-cycle)"
created: 2026-05-15
updated: 2026-05-15
tags: [report, ai, asset-gen, sprite-sheet]
status: active
report_type: session
period: "2026-05-15"
author: TeamLead (TM-142)
---

# TM-142 — sprite-sheet pipeline (4-frame walk-cycle)

## TL;DR

TM-90 single-PNG asset-gen ships static bears that the LLM slides via `translateX` (teleporting billboard). TM-142 adds an opt-in 4-frame walk-cycle pipeline that generates 4 leg-pose PNGs in parallel and ships a `<SpriteAnimator frames={...} fps={8}>` wrapper that cycles them at render time. Cost is ~$0.16/first-gen (4× gpt-image-1 low-tier 1024). Disabled by default — flips on per-request via `AI_SPRITE_SHEET=1` env or `opts.enableSpriteSheet=true`.

## 무엇이 바뀌었나

- New `src/lib/ai/sprite-sheet-stage.ts` — `runSpriteSheetStage()`, hashed cache, per-frame disk idempotency, walk-cycle prompt template (`WALK_CYCLE_FRAME_POSES`).
- New `src/remotion/SpriteAnimator.tsx` — PARAMS-driven cycler with strict `/uploads/sprites/<hash>/<n>.png` URL allow-shape (mirrors CatalogueLottie/CatalogueAudio philosophy).
- Evaluator wired (`src/lib/remotion/evaluator.ts`): `SpriteAnimator` exposed as the 6th positional factory argument.
- Sandbox sanitiser (`src/lib/remotion/sandbox.ts`): strips stray `import { SpriteAnimator } from '@/remotion/SpriteAnimator'` (and a missed CatalogueLottie equivalent).
- `src/lib/ai/generate.ts`: new `SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM`, `injectSpriteFrames`, `isSpriteSheetEnabled`, `finalizeWithSpriteSheet`. Single-shot path now branches: when sprite-sheet is enabled AND living-entity hits AND answers present, run the sprite stage instead of asset-gen and inject the 4-URL array into `PARAMS.spriteFrames`.
- Tests: `__tests__/lib/ai/sprite-sheet-stage.test.ts` (33 cases) — hash determinism, frame prompts, full stage with stub generator (mkdtemp + cwd swap), per-frame partial-failure recovery, URL validators, injection helpers, env helper.

## 왜 / 배경

- TM-135 RCA noted "subject feels static" as the dominant remaining quality complaint after TM-136 wired single-PNG asset-gen into the single-shot path.
- A single still PNG sliding across the screen reads as a teleporting billboard, not a walking creature. 4-frame cycling at 8fps gives the minimum readable walk cycle without a true character-sheet model or external animation runtime.
- User explicitly approved 4 gpt-image-1 calls/sprite (~$0.16) and "no new deps (Remotion `<Img>` + state animation)" — so we use `useCurrentFrame` + modulo arithmetic, no `lottie`, no `sharp`, no `canvas`.

## 영향

- Code: 2 new files (~330 LOC), 4 edits (evaluator, sandbox, generate, +1 test). Asset-gen path UNCHANGED — sprite-sheet is mutually exclusive at branch-entry, never both for the same prompt.
- Cost: opt-in only. Default behaviour identical to today. When enabled, ~$0.16 first-gen per (prompt, answers) tuple; cached hits free.
- Surface area: `<SpriteAnimator>` is a sandbox-injected global with a strict url allow-shape (`^/uploads/sprites/[a-f0-9]+/[0-9]+\.png$`). PARAMS values are LLM-controlled, so the wrapper renders nothing for malformed URLs (path traversal, external https, wrong extension). No bare `<Img>` deny added — TM-136 single-image flow still emits raw `<Img src={PARAMS.imageUrl}>`.
- Cache stability: `SPRITE_SHEET_SYSTEM_PROMPT_ADDENDUM` is suffix-only (ADR-0003) and mutually exclusive with the asset-gen addendum, so cache prefix stays stable across (prompt, sprite-on/off) variants.

## 다음 액션

- Live verify (out of band, env `AI_SPRITE_SHEET=1`): "곰돌이가 초원을 걷는 4-frame 10초 영상" → confirm 4 PNGs land under `public/uploads/sprites/<hash>/`, SpriteAnimator renders, walk cycle visible. Cost cap $0.50 (one cycle).
- Visual-quality bench (TM-46 r-next sweep, side-by-side TM-136 vs TM-142) before flipping default. Pre-bench expectation: walking/running/jumping prompts win on TM-142, idle/static-pose prompts neutral or slight regression (4× cost for no animation gain).
- TM-138 self-critique does not currently run on sprite frames (judge is single-PNG-shaped). Optional follow-up: judge frame 1 only, accept the others on faith — keeps cost at 1 extra judge call vs 4.

## 검증

- `npx jest __tests__/lib/ai/sprite-sheet-stage.test.ts` → 33/33 pass.
- Regression: `npx jest __tests__/lib/ai/asset-gen-stage.test.ts __tests__/lib/ai/generate-tm136-asset-gen.test.ts __tests__/lib/ai/generate.test.ts` → 66/66 pass.
- Typecheck: no new errors introduced (preexisting failures unrelated — fuzz test ES2018 flag, leak fixture imports, plugin .ts extension).
