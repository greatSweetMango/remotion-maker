---
type: session
task: TM-169
parent: TM-166
date: 2026-05-18
tags: [sandbox, validation, img, tm-166-followup]
---

# TM-169 — `<Img src>` expression allow-list

## Why
TM-166 RCA bullet #4: scene-code system prompt (`pipeline.ts` L717) tells the LLM to emit `<Img src={imageUrl} ... />` — a bare identifier. Generated components never bind `imageUrl`; only `PARAMS.imageUrl` is in scope (ADR-0002). Runtime throws `ReferenceError`, TM-116 `SceneBoundary` swallows it → blank scene. Static validation surfaces the bad shape at the edit gate so the LLM can self-correct on the next iteration.

## What

### `src/lib/remotion/sandbox.ts` — added `validateImgSrc(code)`
Allowed `src` shapes:
- `src="literal"` / `src='literal'` (string-literal attribute)
- `src={"literal"}` / `src={'literal'}`
- `src={PARAMS.<key>}` (any `<key>`)
- `src={staticFile("literal")}`

Rejected:
- `src={imageUrl}` (bare identifier — the TM-166 #4 case)
- `src={fetchUrl()}` (arbitrary function call)
- `src={`/uploads/${slug}.png`}` (template literal)
- `src={user.avatar}` (non-PARAMS member access)
- `src={PARAMS.x || fallback}` (compound expression)
- `src={staticFile(slug)}` (non-literal staticFile arg)
- `<Img />` with no src attribute

Implementation uses brace-balanced tag extraction (handles `style={{...}}` etc.) and a balanced-brace extractor for the `src={...}` expression body before matching against permitted-shape regexes.

### Mirror in `plugin/remotion-eval/src/validate.ts`
Same logic, called from `validateRemotionCode` (TM-115 invariant). Also synced the previously-missing `<Lottie>` deny entry (TM-140 drift discovered during the TM-115 sync test).

### Tests
- `__tests__/lib/remotion/sandbox.test.ts` — 14 new cases (6 positive, 8 negative)
- `plugin/remotion-eval/test/validate.test.ts` — 7 new cases mirroring the same matrix
- All sandbox tests green (75/75); plugin tests green (39/39)

## Out of scope
The prompt at `src/lib/ai/pipeline.ts:717` itself still asks for `<Img src={imageUrl}>`. Fixing the prompt to teach `<Img src={PARAMS.imageUrl}>` is a separate task — but with TM-169 in place the validator will now catch and retry the bad output if/when the LLM produces it.

## Files
- `src/lib/remotion/sandbox.ts`
- `plugin/remotion-eval/src/validate.ts`
- `__tests__/lib/remotion/sandbox.test.ts`
- `plugin/remotion-eval/test/validate.test.ts`
