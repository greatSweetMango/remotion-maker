---
title: TM-152 — Circular-dependency audit (week-2 refactor)
date: 2026-05-18
tags: [refactor, tooling, dependency-graph]
task: TM-152
---

# TM-152 — Circular dependencies: 0 true cycles, 1 acceptable dynamic-import pair

## TL;DR

The repo has **zero static circular dependencies**. `madge` reports a single
cycle (`lib/ai/generate.ts ↔ lib/ai/pipeline.ts`), but both edges are
documented `await import(...)` calls placed specifically to defer module
graph closure to runtime. `dependency-cruiser` correctly classifies this as
a non-cycle (0 violations across 331 modules / 603 edges).

A persistent guard is now wired in:

- `.dependency-cruiser.cjs` — config, severity `error` on `no-circular`.
- `npm run check:circular` — runs the guard against `src/**/*.{ts,tsx}`.

If a future PR introduces a real static cycle, the script will fail (and
should be added to CI as a follow-up).

## Audit

### Tools

- `madge@8` (default; counts dynamic imports as cycle edges)
- `dependency-cruiser@17` (`tsPreCompilationDeps: true`, respects dynamic imports)

### Results

| Scope | madge cycles | dep-cruiser cycles |
|---|---|---|
| `src/` (187 files) | 1 | 0 |
| `src/` + `__tests__/` (233 files) | 1 (same) | n/a |
| `src/` + `scripts/` (30 files) | 1 (same) | n/a |

Reports archived under `wiki/05-reports/screenshots/TM-152/`.

### The one madge-reported pair

```
1) lib/ai/generate.ts > lib/ai/pipeline.ts
```

- `generate.ts:613` — `const { generateAssetMultiStepAsApiResponse } = await import('./pipeline');`
- `pipeline.ts:1258` — `const { generateAsset } = await import('./generate');`

Both call sites carry a `// Dynamic import to avoid a circular dep` comment.
The cycle exists only in the static import graph (madge's view); at runtime
module initialization closes cleanly on either entry point because the
deferred import resolves the *already-initialized* counterpart.

Classification: **acceptable** (per Phase B criteria).

## Why this is the right structure

`generate.ts` is the single-shot path; `pipeline.ts` is the multi-step
pipeline. Each is a valid entry point and each must be able to *fall back*
to the other:

- `generate.ts` → `pipeline.ts`: when `AI_MULTI_STEP=1` or auto-detected
  living-entity prompts trigger the multi-step path.
- `pipeline.ts` → `generate.ts`: when the multi-step pipeline fails and
  TM-111 forces a single-shot fallback.

Untangling these via a shared "router" module would add a third file with no
behavioral win. Dynamic imports already provide the correct safety net.

## What was *not* done

- No structural refactor was needed (Phase C scope was empty).
- No edits to `generate.ts` or `pipeline.ts`.
- CI integration of `check:circular` is left as a tiny follow-up (would
  belong in `scripts/ci/*` and any GH action).

## How to run

```bash
npm run check:circular
# → ✔ no dependency violations found (331 modules, 603 dependencies cruised)
```

To audit with madge (matches this report):

```bash
npx madge --circular --extensions ts,tsx,js,jsx src/
```

## Refs

- ADR-0001 (Edit ≠ Render) — pipeline & single-shot both serve the edit path.
- `src/lib/ai/generate.ts`, `src/lib/ai/pipeline.ts`
- TM-94 scheduler (refactor week-2 spawn)
