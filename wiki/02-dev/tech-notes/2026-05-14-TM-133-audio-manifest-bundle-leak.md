---
title: "TM-133 — audio manifest server-only split"
date: 2026-05-14
tags:
  - "#tech-note"
  - "#bundle"
  - "#audio"
  - "#nextjs"
  - "#turbopack"
related:
  - TM-127
  - TM-128
  - TM-130
  - TM-132
  - TM-81
adr: ADR-0026
---

# Symptom

Landing page (`/`) build broke immediately after TM-132 shipped:

```
Code generation for chunk item errored
./src/lib/audio/manifest.ts
- the chunking context (unknown) does not support external modules
  (request: node:fs/promises)
Import traces:
  ./src/lib/audio/manifest.ts
    → ./src/remotion/CatalogueAudio.tsx
    → ./src/lib/remotion/evaluator.ts
    → ./src/components/gallery/TemplateCard.tsx
    → ./src/app/(marketing)/_LandingClient.tsx
    → page.tsx
```

Pure-static landing route was unbuildable — full launch blocker.

# Root cause

Same shape as TM-81 (prisma client bundle leak):

`src/lib/audio/manifest.ts` (TM-127) colocated **two unrelated surfaces** in
one module:

1. **Client-safe**: `AUDIO_MOODS` const, `AudioMood`/`AudioTrack`/
   `AudioManifest` types, `FILENAME_RE`, the synchronous
   `isValidCatalogTrack(track)` shape predicate, and the pure
   `parseAudioManifest(raw)` validator. None of these touch fs.
2. **Server-only**: `loadAudioManifest()`, `verifyAudioCatalogueIntegrity()`,
   `hashAudioAsset()`, `DEFAULT_MANIFEST_PATH` — all built on
   `node:fs/promises`, `node:crypto`, `node:path`, `process.cwd()`.

TM-132's `<CatalogueAudio>` wrapper imported only `isValidCatalogTrack`
(group 1), but ESM module-level evaluation pulled the whole file —
including the top-level `import { readFile } from 'node:fs/promises'`. The
Remotion bundle is reachable from the marketing page via:

```
TemplateCard → evaluator (templates use Remotion at runtime to render
previews) → CatalogueAudio → manifest.ts → node:fs/promises
```

Turbopack's client/edge chunking context cannot resolve `node:*` external
modules → build fails.

# Fix

Split along the server/client boundary (mirrors TM-81's
`tier-limits` / `usage` split):

| New file | Surface | Boundary |
|---|---|---|
| `src/lib/audio/manifest-types.ts` | types, `AUDIO_MOODS`, `FILENAME_RE`, `SHA256_RE`, `isValidCatalogTrack`, `parseAudioManifest` | client-safe |
| `src/lib/audio/manifest-loader.ts` | `loadAudioManifest`, `hashAudioAsset`, `verifyAudioCatalogueIntegrity`, `DEFAULT_MANIFEST_PATH` | `import 'server-only'` sentinel |
| `src/lib/audio/manifest.ts` | barrel — re-exports **only** the client-safe surface from `manifest-types` | client-safe |

The barrel is kept so any code path that only consumed types/predicates
keeps working without churn. Re-exporting the loader from the barrel was
deliberately avoided — that would put the import back in the client graph
and re-introduce the leak.

Updated importers:

- `src/remotion/CatalogueAudio.tsx` → imports from `manifest-types` directly
  (documents intent + removes a bundler hop).
- `src/app/api/audio/manifest/route.ts` → imports `loadAudioManifest` from
  `manifest-loader`, type from `manifest-types`.
- `__tests__/lib/audio-manifest.test.ts` → split imports to match the new
  layout.

`server-only` precedent: `src/lib/usage.ts` (TM-81), already in
package.json deps — no new npm dependency.

# Verification

- `npm run build` → ✓ Compiled successfully in 6.5s, all 25 routes built.
- `curl http://localhost:3133/` → HTTP 200, 1.13 MB, dev log shows zero
  `node:fs` chunking errors.
- `npx jest __tests__/lib/audio-manifest.test.ts
  __tests__/lib/audio-catalog-track.test.ts
  __tests__/api/audio/manifest.test.ts
  __tests__/lib/ai/prompts-audio-policy.test.ts` → 58/58 passed.
- `npx tsc --noEmit` → no errors on touched files (pre-existing errors in
  unrelated `__tests__/benchmarks/`, `plugin/**` are unchanged).

# Lesson / guardrail

**Any module that mixes pure validators with `node:*` imports is a
landmine the moment a Remotion or shared component imports the validator.**
The TM-81 retro flagged this exact pattern in `usage.ts`; the TM-127
manifest module repeated it. Future audit candidates with the same shape:

- any `src/lib/**` module that has both `import 'node:fs'` AND a sync
  pure-function export.

Convention going forward: when a module needs both surfaces, split into
`<name>-types.ts` (client-safe) + `<name>-loader.ts` (`'server-only'`)
from day one and keep the bare `<name>.ts` (if any) as a client-safe
barrel only.
