---
title: TM-181 — scene-prefixed `imageUrl` regression in multi-step pipeline
date: 2026-05-19
tags: [tech-note, pipeline, multi-step, imageUrl, validator, TM-181, TM-168, TM-178]
---

## What broke

TM-173 regression corpus surfaced 7/8 character cases failing the multi-step
pipeline. Dev-log RCA:

```
[TM-111] multi-step pipeline failed, falling back to single-shot:
TM-102 composed code failed sandbox validation after TM-111 sanitize:
imageUrl rule: <Img src={scene0_imageUrl}> must reference PARAMS.imageUrl
```

`SCENE_CODE_SYSTEM_PROMPT` told the LLM to prefix every per-scene
PARAMS key with `scene{N}_` (rule #1) AND to read the asset-gen PNG via
`PARAMS.imageUrl` (rule A). The model conflated the two and emitted
`<Img src={scene0_imageUrl} />`, `<Img src={PARAMS.scene1_imageUrl} />`,
and even `scene{N}_imageUrl: '...'` shadow entries inside per-scene
params consts.

TM-168 validator (correctly) rejected those references — the only legal
`<Img>` src forms are `PARAMS.imageUrl`, a destructured `imageUrl` prop
default, or a literal string. The validator rejection bubbled through
TM-111's catch as a pipeline failure, single-shot fallback fired, and
the asset-gen PNG was silently dropped.

## Fix (two-pronged)

### Prompt (`src/lib/ai/prompts.ts`)

Inline a TM-181 callout under section A of `SCENE_CODE_SYSTEM_PROMPT`:
`imageUrl` is GLOBAL, not per-scene-prefixed. Added explicit anti-pattern
entry in the burn list (`<Img src={scene0_imageUrl}>` →
automatic FAILURE).

### Compose sanitize hook (`src/lib/ai/pipeline.ts` `composeSceneCodes`)

Runs after fragment rename, before the TM-178 bare-`imageUrl` shim:

1. `PARAMS.scene\d+_imageUrl` → `PARAMS.imageUrl`
2. Bare `scene\d+_imageUrl` identifier (negative lookbehind on `[.\w]`,
   negative lookahead on `:` so object-keys are handled in step 3) →
   `PARAMS.imageUrl`
3. `scene\d+_imageUrl: <value>,?` entries in per-scene params object
   literals → stripped (top-level `PARAMS.imageUrl` is the source of
   truth; per-scene shadow breaks ADR-0002 auto-extract)

Validator is intentionally unchanged — it's the correct gate, the
sanitize hook brings the LLM's drift back into compliance before the
validator runs.

## Why not just fix the prompt?

Tried prompt-only first in spirit (the TM-167 character block is already
maximally strict). gpt-4o still drifts on edge cases. The validator
rejection cost was the full multi-step pipeline → fallback → asset-loss.
The sanitize hook is cheap (4 regex passes per fragment), deterministic,
and silently rescues the LLM without burning a re-call.

This mirrors the TM-178 bare-`imageUrl` shim pattern, which made the
same architectural call: prompt for correctness, sanitize for resilience.

## Verification

Unit: `__tests__/lib/ai/pipeline.test.ts` adds 6 TM-181 cases —
bare `scene0_imageUrl`, `PARAMS.scene0_imageUrl`, shadow entry strip,
no-op on clean PARAMS.imageUrl, two-digit indices (`scene10_`,
`scene12_`), no-corruption guard for `scene0_image_caption`. All
84 pipeline tests pass.

Live full-corpus rerun (13 prompts) is deferred to a follow-up
TM-173-r2 spawn after this lands on main.

## Related

- TM-168 — validator that catches the bad src (kept strict, no change)
- TM-178 — bare-`imageUrl` shim (this fix is the scene-prefixed sibling)
- TM-173 — regression corpus that surfaced the bug
- ADR-0022 — `imageUrl` PARAMS contract
- ADR-0002 — PARAMS auto-extract for customize UI
