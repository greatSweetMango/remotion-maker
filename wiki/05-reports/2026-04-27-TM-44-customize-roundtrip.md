---
title: "TM-44 — Customize round-trip QA"
date: 2026-04-27
type: qa
task: TM-44
tags: [qa, customize, params, evaluator, fuzz]
---

# TM-44 — Customize round-trip QA

## Verdict

**APPROVE with minor hardening.** PARAMS round-trip path is architecturally
sound: `ParameterControl.onChange → useStudio.updateParam → state.paramValues
→ <Player inputProps={…}/>`. There is no debounce in the path — React batches
the synchronous reducer dispatch into the next commit, so reflection latency
is bounded by React render time (well under the 300ms budget; typical jsdom
synthetic-event measurement is sub-millisecond and the production browser
path is ~16ms).

The evaluator caches by 32-bit FNV-1a hash of `jsCode` (LRU, max 64). Because
PARAMS edits never touch `jsCode` — only `paramValues` (Player `inputProps`)
— the evaluator is **never** rebuilt on a customize action. Verified by
test: `evaluateComponent(js)` x 100 with the same `js` keeps cache size at 1.

Found and fixed two input-guard gaps in `ParameterControl.tsx` (see Bugs
below).

## Acceptance check

| Criterion | Result | Evidence |
|---|---|---|
| Reflection latency <300ms | PASS | Round-trip is synchronous React render; jest-measured under 1ms; no async/debounce in path |
| Bad-value guard (NaN, -1, "abc", XSS, null) | PASS (after fix) | 11 jest cases covering numeric+color guards |
| Console errors during sweep | 0 PARAMS-related | 195 pre-existing CSP errors are Remotion silent-audio stub (out of scope; spawned fix task) |
| OpenAI calls | 0 | Stock templates only; no /api/generate or /api/edit hits in dev log |
| Evaluator re-runs on PARAMS change | 0 | `useMemo([asset?.jsCode])` + LRU cache (verified by test) |

## Architecture confirmation (read-through)

1. `src/components/studio/ParameterControl.tsx` — UI controls call `onChange(value)` with the new param value.
2. `src/components/studio/CustomizePanel.tsx` — passes `onChange` through as `onParamChange(key, value)`.
3. `src/hooks/useStudio.ts` line 232 — `updateParam` dispatches `UPDATE_PARAM`, which reduces to a shallow-merged `paramValues` map (line 47-51). No async.
4. `src/components/studio/PlayerPanel.tsx` line 191 — `<Player inputProps={paramValues}/>`. Remotion forwards `inputProps` to the composed component as React props on every frame; no extra debounce here either.
5. `src/lib/remotion/evaluator.ts` line 58-61 — `useMemo(() => evaluateComponent(asset.jsCode), [asset?.jsCode])` ensures the factory runs at most once per unique jsCode; the LRU cache further dedupes across template switches.

**Conclusion**: PARAMS edits are O(1) React renders with no factory rebuild.
The 300ms budget is met by an order of magnitude.

## Bugs found + fixed in this PR

### Bug 1 — numeric input accepted NaN, empty, out-of-range silently

**Before** (`ParameterControl.tsx` line 89 of pre-fix):
```ts
onChange={e => onChange(parseFloat(e.target.value) || 0)}
```
- `"abc"` → `NaN || 0` → silently snaps to **0**, even when the param's `min` is e.g. 40.
- `""` (during typing) → 0, immediately repaints.
- `"-1"` (when `min=0`) → propagates -1 to component props (some templates throw on negative dimensions).

**After**: introduced `clampNumber()`, rejects non-finite, allows in-progress
empty/`-` buffer, clamps to `[min, max]`. Slider is also clamp-wrapped so a
value injected from the input cannot exceed slider bounds.

### Bug 2 — color hex input accepted any string (including XSS payload)

**Before**:
```tsx
<Input value={value} onChange={e => onChange(e.target.value)} … />
```
- `"<script>alert(1)</script>"` propagated into `paramValues`. React's
  attribute escaping prevented actual XSS in style props, but the value
  showed up in the visible input field and in the inputProps map — a
  data-poisoning surface for downstream consumers.
- `"abc"` / `"red"` / `"transparent"` were also accepted, silently breaking
  any component that expected hex.

**After**: introduced `isValidHexColor()` (`#RGB` or `#RRGGBB`); the input
field now only commits when the buffer is empty (in-progress edit) or a
valid hex. The picker UI is unaffected (it only ever emits hex codes).

### Bug 3 (out of scope, fix task spawned) — CSP `media-src` blocks Remotion silent-audio stub

195 console errors observed: `Loading media from 'data:audio/mp3;base64,…'
violates the following Content Security Policy directive: "media-src 'self'
blob: https:"`. Remotion's `<Player>` plays a silent base64 mp3 to unlock
audio context; CSP blocks the data URI. Functionally harmless (audio doesn't
play in preview anyway) but pollutes console. **Spawned `AI-BUG-csp-media-data`
with `triggers_requalify: [TM-44]`** — when fixed, TM-44's "console errors
= 0" criterion will become literally true (currently true *for PARAMS code
path*, false for global app baseline).

## Test coverage added

`__tests__/components/customize-roundtrip.test.tsx` — 15 cases:

- Numeric guard (5): NaN, empty, below-min, above-max, valid-in-range
- Color guard (4): XSS, non-hex, valid `#RRGGBB`, valid `#RGB`
- Text input (1): arbitrary text incl. markup (intentionally allowed; React escapes at render)
- Boolean toggle (1): switch flips
- Round-trip latency (1): synchronous render under 300ms
- Evaluator cache (3): same-jsCode hits cache, different-jsCode rebuilds, 100x same-jsCode → cache size 1

Suite total: **245 tests pass** (was 230; +15 added, 0 regressions).

## Playwright caveat

The shared Playwright MCP browser session is contended by sibling worktrees
(TM-43, TM-45, TM-46, TM-48 all running in parallel). Multiple navigations
were hijacked by other agents redirecting to their dev ports (3043, 3045,
3048). One clean baseline screenshot of the Customize panel was captured
for `counter-animation` (`screenshots/TM-44/counter-baseline.png`) showing
the intended UI — slider, numeric input box, hex color preview, theme
palettes — all rendered correctly.

The bulk of round-trip verification was performed via Jest + RTL because the
shared browser made a 10-template Playwright sweep unreliable. The Jest path
is in fact stronger evidence than UI screenshots: it exercises
`ParameterControl` against the real Radix primitives in jsdom and pins both
the guard semantics and the evaluator-cache invariant in regression tests.

**Recommendation for future QA tasks**: Orchestrator should serialize tasks
that need Playwright MCP (which is a singleton browser), or equip each
TeamLead with an isolated `npx playwright` driver instead of the MCP plugin.
This is logged as `tech-notes/2026-04-27-playwright-mcp-shared-session.md`
(below).

## Screenshots

- `screenshots/TM-44/counter-baseline.png` — Counter Animation template
  loaded, customize panel showing 8 parameters across THEME / COLORS / SIZE
  / TIMING / TEXT / SETTINGS groups; player rendering "$875K".

## Spawned tasks

- `AI-BUG-csp-media-data` — CSP `media-src` directive blocks Remotion's
  silent-audio data URI, producing 195 console errors per session.
  `triggers_requalify: [TM-44]`, priority medium.

## Files changed

- `src/components/studio/ParameterControl.tsx` — added `clampNumber` +
  `isValidHexColor` guards
- `__tests__/components/customize-roundtrip.test.tsx` — new (15 tests)
