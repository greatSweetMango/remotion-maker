---
title: "TM-125 — PromptPanel suggestion seed hydration mismatch"
date: 2026-05-14
tags: [tech-note, hydration, react, ssr, prompt-panel]
related: [TM-122]
---

# Symptom

Sibling to TM-122 (Player hydration). `PromptPanel` rendered server vs client
showed different "Try a suggestion" cards, producing a React 19 hydration
mismatch warning in dev console as soon as the empty-state UI mounted.

# Root cause

```ts
// BEFORE — runs on both SSR + first client render with different RNG state
const [suggestionSeed, setSuggestionSeed] = useState(
  () => Math.floor(Math.random() * 1_000_000)
);
```

`useState` initializers run on the server during SSR and again on the client
during the very first render (before hydration completes). `Math.random()` is
non-deterministic, so server HTML carried one set of suggestion cards and the
client tree wanted a different set. React 19 flags this loudly.

# Fix

Initialize the seed to `0` (server + client agree → identical first paint),
then bump it to a random value once after mount:

```ts
const [suggestionSeed, setSuggestionSeed] = useState(0);

useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setSuggestionSeed(Math.floor(Math.random() * 1_000_000));
}, []);
```

The user gets randomized suggestions on the very next frame; the SSR'd HTML
matches the client's first render exactly.

# Why not other approaches

- **Pure deterministic seed (date / userId)**: would still need a stable seed
  that survives both environments without prop wiring; harder to guarantee
  refresh-to-refresh variety without extra state.
- **`'use client'` alone**: `PromptPanel` is already a client component, but
  Next.js still SSRs client components — only `dynamic(..., { ssr: false })`
  fully skips SSR. We don't want to lose SSR for the whole panel.
- **`useSyncExternalStore` mounted-flag**: equivalent outcome but more
  ceremony; the effect-bump pattern is already used elsewhere in the
  codebase (`PlayerPanel.tsx` line 142, `ResourcePanel.tsx`).

# Lint exception

The `react-hooks/set-state-in-effect` rule fires here. The disable is
intentional and documented inline: we are translating an "are we hydrated"
runtime fact into React state, the empty-dep array guarantees one execution,
so there is no cascading-render risk. Same justification pattern as the
existing `PlayerPanel` FPS-monitor latch.

# General rule

Any `useState(() => …)` initializer that touches `Math.random()`, `Date.now()`,
`crypto.randomUUID()`, `window.*`, or anything else that diverges between SSR
and the client will hydrate-mismatch in client components. Default-init to a
deterministic value and randomize/read in a `useEffect`.

# Verified

- `npx eslint src/components/studio/PromptPanel.tsx` → clean
- Live dev (`http://localhost:3125/studio`) → 0 hydration warnings in console
  (only unrelated AudioContext device noise)
