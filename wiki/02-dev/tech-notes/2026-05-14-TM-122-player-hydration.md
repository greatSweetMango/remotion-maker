---
title: TM-122 — Remotion Player SSR hydration mismatch
date: 2026-05-14
tags: [tech-note, hydration, remotion, next16, player]
---

# Symptom

Studio (and any page containing `<Player>`) showed dozens of React hydration
mismatch errors in the browser console on every load:

```
+ x2={-355.9574246867301}     (client)
- x2="-355.95742468673006"    (server)
```

The mismatched attributes were all on SVG nodes inside the Remotion-rendered
composition (line/path coordinates) and occasionally on `transform: matrix(...)`
strings. The numeric values differed only in the last 1–2 floating-point
digits.

# Root cause

Every wrapper that mounts `<Player>` was already a Client Component
(`'use client'`), but in Next.js 16 the App Router still SSRs client
components on the initial request. During that server render Remotion evaluates
`useCurrentFrame()` at frame 0 and runs the user composition's interpolations.
The resulting floats are serialized into HTML via `toString()`, whereas on
hydration React reads the JSX value as a number — `Number(...).toString()` is
not byte-identical to the server's representation for many trailing-digit
floats, so React flags every such attribute as a mismatch.

The Remotion docs recommend rendering Player only on the client for exactly
this reason.

# Fix

`src/components/studio/ClientPlayer.tsx` — a thin module that re-exports
`Player` via `next/dynamic(() => import('@remotion/player'), { ssr: false })`.
All five call sites were switched to import from this wrapper instead of
`@remotion/player` directly:

- `src/components/studio/PlayerPanel.tsx`
- `src/components/share/SharePlayer.tsx`
- `src/components/studio/TemplatePicker.tsx`
- `src/components/gallery/TemplateCard.tsx`
- `src/app/dev-eval-fixture/client.tsx`
- `src/app/dev-fluid-preview/client.tsx`

`next/dynamic` strips React refs from the loader proxy, so `ClientPlayer`
accepts the ref under a renamed `playerRef` prop and re-attaches it inside
the dynamic loader factory. `PlayerPanel` was the only call site using a ref
and was updated to pass `playerRef={playerRef}` instead of `ref={playerRef}`.

# Verification

- `tsc --noEmit` — no new errors in changed files.
- `eslint` on changed files — only one pre-existing
  `react-hooks/preserve-manual-memoization` warning on PlayerPanel.tsx
  (unrelated, present on `main`).
- Live dev (`PORT=3122 npm run dev`):
  - `/dev-fluid-preview`: 0 console errors, 0 warnings (other than the
    standard Remotion license notice).
  - `/studio`: 0 SVG/numeric hydration mismatches. One unrelated hydration
    error remains from PromptPanel's prompt-suggestion picker (it picks
    randomized suggestions on every render) — out of scope for TM-122.

# Gotcha for future Player work

Always import `Player` from `@/components/studio/ClientPlayer`, never directly
from `@remotion/player`. The direct import will SSR and re-introduce float
mismatches the moment a user-authored composition uses any `interpolate(...)`
or `spring(...)` math (which is virtually all of them).
