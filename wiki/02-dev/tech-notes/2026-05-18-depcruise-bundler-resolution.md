---
tags: [tech-note, ci, dependency-cruiser, tm-155]
date: 2026-05-18
---

# dependency-cruiser under `moduleResolution: "bundler"`

## Symptom
`npm run check:circular` reported `0 violations` even when a synthetic
mutual-import probe (`src/_probe/{a,b}.ts`) was added — both with relative
(`./b`) and `@/` alias imports. CI guard (TM-152, wired in TM-154) was
green for the wrong reason.

## Root cause
Two compounding issues:

1. **`npx --yes dependency-cruiser`** resolved to whichever cached
   version `npx` happened to hold, with no lock — behavior could
   silently drift between sessions.
2. The default enhanced-resolve options in dep-cruiser don't include
   `.ts/.tsx` in the extension list and don't honor tsconfig `paths`
   under `moduleResolution: "bundler"`, so local TS edges
   (and `@/` alias edges) were never added to the dependency graph.
   No graph edges → no cycle detection.

## Fix (TM-155)
- `npm i -D dependency-cruiser@^17.4.0`; script now `depcruise -c ...`.
- `.dependency-cruiser.cjs` gains:
  ```js
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'require', 'node', 'default'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    mainFields: ['module', 'main', 'types'],
  }
  ```
- The `no-circular` rule is narrowed to `to: { circular: true, dynamic: false }`
  so the documented `await import()` mitigation
  (`lib/ai/generate.ts ↔ lib/ai/pipeline.ts`) doesn't trip the guard,
  while real static cycles still fail.

## Verification probe
Drop these two files temporarily under `src/_probe/`:
```ts
// a.ts
import './b';
export const a = 1;
// b.ts
import './a';
export const b = 1;
```
Then `npm run check:circular` → exit 1, 1 violation.
Swap `./` → `@/_probe/` and re-run → still 1 violation.
Remove the probe → exit 0, 0 violations (~226 modules).

## Gotcha to remember
If you ever add a fresh local rule to depcruise, sanity-check the
graph size in the output (`N modules, M dependencies cruised`).
If `N` is suspiciously low or doesn't grow when you add files,
resolution is silently broken — re-run the probe.
