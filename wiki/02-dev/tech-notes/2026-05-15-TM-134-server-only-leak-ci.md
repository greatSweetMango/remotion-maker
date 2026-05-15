---
title: "TM-134 — CI lint to detect server-only → client-bundle leaks"
date: 2026-05-15
tags:
  - "#tech-note"
  - "#bundle"
  - "#ci"
  - "#nextjs"
  - "#turbopack"
related:
  - TM-81
  - TM-133
adr: ADR-0026
---

# Why

We hit the same shape of bug twice:

- **TM-81** — `src/lib/usage.ts` top-level imports `prisma` (→ `node:fs`).
  A `'use client'` `PromptPanel` imported `TIER_LIMITS` from `usage.ts`,
  which silently dragged prisma + `node:fs` into the browser chunk.
- **TM-133** — `src/lib/audio/manifest.ts` colocated a sync
  `isValidCatalogTrack` validator with `loadAudioManifest()` (which
  uses `node:fs/promises`). A Remotion `<CatalogueAudio>` wrapper imported
  only the validator, but ESM evaluated the whole module → the marketing
  page failed to build with `the chunking context (unknown) does not
  support external modules (request: node:fs/promises)`.

Both were caught at runtime / build time, after the bad import had
landed on `main`. We now want the same failure, but earlier and with a
clearer message.

# What

`scripts/ci/check-server-only-leaks.mjs` — a stdlib-only Node script
that walks the `src/**` import graph and reports any chain from a
`'use client'` file to a "tainted" module (a file that imports
`'server-only'` or any `node:*` builtin).

Wired into:

- `package.json` → `npm run lint:server-only-leaks`
- `.github/workflows/lint-server-only-leaks.yml` — runs on every push/PR
  touching `src/**`. ~3s cold.

Fixture-based unit tests at `__tests__/scripts/check-server-only-leaks.test.ts`
cover the four key behaviors (good/direct-leak/transitive-leak/
server-action-boundary).

# How it decides

Definitions:

- **client seed**: a file whose first 5 non-empty lines (after stripping
  comments) contain a bare `'use client'` directive.
- **tainted seed**: any file that imports the literal `'server-only'`
  module, OR any `node:*` builtin specifier.
- **boundary**: a file whose first 5 non-empty lines contain a bare
  `'use server'` directive. These are Server Actions modules — Next
  compiles them to RPC stubs for the client, so their bodies never
  ship to the browser. The traversal does NOT cross into them.

Algorithm: BFS the import graph from each client seed. If a tainted
seed is reached without crossing a boundary, record the chain. Output
is deduped per `(tainted, direct-importer-of-tainted)` so the developer
gets one report per actionable import line.

Module resolution is conservative:

- `@/foo` → `<root>/src/foo` (matches `tsconfig.json` paths)
- relative paths resolved against the importer
- extensions tried: `.ts .tsx .js .jsx .mjs .cjs`, plus `<dir>/index.<ext>`
- bare specifiers (npm packages) are ignored, except `'server-only'`
  which is the taint marker

Both static `import ... from '...'` and dynamic `import('...')` are
parsed. Side-effect imports (`import 'foo'`) too.

# What it does NOT cover (intentional)

- **`page.tsx` / `layout.tsx` server components** are not seeded as
  "client-reachable". Server components can freely import server-only
  modules; a leak only happens when a `'use client'` component is in
  the chain. Next's RSC boundary handles the rest.
- **Dynamic imports with non-literal specifiers** (`import(varName)`)
  are not resolved — those are rare in this codebase and Next would
  warn about them anyway.
- **Re-exports through `export * from`** are followed (treated like
  imports), but not symbol-level granularity. A barrel that re-exports
  only client-safe symbols but happens to also `export * from
  'server-loader'` would still be flagged — which we want.

# Output format

On failure (matches the TM-133 retro format):

```
check-server-only-leaks: FAIL — 1 leak(s) detected (TM-81 / TM-133 pattern)

Server-only module reaches client bundle:
  ./src/lib/usage.ts
    → ./src/components/ui/popover.tsx
    → ./src/components/studio/ParameterControl.tsx
    → ./src/components/studio/CustomizePanel.tsx

Fix: split the module along the server/client boundary
(see wiki/02-dev/tech-notes/2026-05-14-TM-133-audio-manifest-bundle-leak.md).
```

`--json` produces machine-readable output for tooling.

# Verification

1. Current `main` (HEAD `176a047`): script reports 0 leaks across 180
   scanned files, 46 client seeds, 10 tainted seeds. False-positive
   check passed (initial run flagged the `dev-login/actions.ts` chain;
   adding `'use server'` boundary handling cleared it — the actual
   runtime behavior is RPC stub, not a real leak).
2. Synthetic injection: temporarily added `import { TIER_LIMITS } from
   '@/lib/usage'` to `src/components/ui/popover.tsx` (a `'use client'`
   file). Script failed loudly with the chain
   `popover.tsx → ParameterControl.tsx → CustomizePanel.tsx → usage.ts`.
   Reverted, script returned to OK.
3. `npx jest __tests__/scripts/check-server-only-leaks.test.ts` → 4/4
   pass. Each test exercises one of: clean tree, direct leak,
   transitive leak through a non-tainted middle module, server-action
   RPC boundary (no leak).

# Convention going forward

When a module needs both client-safe and server-only surfaces, split
from day one (per TM-133 retro):

- `<name>-types.ts` — types, regex, sync pure validators (client-safe)
- `<name>-loader.ts` — top-line `import 'server-only'` + the `node:*`
  surface
- (optional) `<name>.ts` — barrel that re-exports ONLY the client-safe
  half from `<name>-types.ts`. **Never** re-export the loader from the
  barrel — that puts it back in the client graph.

If you must temporarily violate this (e.g. during a refactor), the CI
check will fail and tell you exactly which import chain to fix.
