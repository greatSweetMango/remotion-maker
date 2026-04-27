# ADR-0011 — Lucide as a runtime global, not an import

## Status
Accepted — 2026-04-26 (TM-22, PR #18).

## Context
The generation/edit sandbox evaluates user TSX via `new Function` — no module resolver. ADR-0002 requires single self-contained snippet. The sandbox sanitizer strips ESM imports because they would throw inside `new Function`.

We want users (and the LLM) to use Lucide icons inside generated animations.

## Decision
Expose `lucide-react`'s namespace export as a `lucide` global injected into the evaluator's factory function — exactly mirroring how `remotion` is injected. System prompt instructs model to destructure from `lucide` (`const { Heart, Star } = lucide;`) and never to write `import ... from 'lucide-react'`. Sanitizer strips lucide-react imports defensively.

A new `'icon'` value added to `ParameterType`. When PARAMS includes `// type: icon`, customize panel renders icon picker (50+ curated popular icons + tag search) backed by `src/lib/lucide-catalog.ts`.

Names follow Lucide v1 conventions (House, LockOpen, ChartBar, ChartPie).

## Consequences
+ Zero new dependencies (lucide-react already shipped)
+ Generated code stays import-free, preserving prompt-cache key (ADR-0003)
+ Icons tree-shaken at app build but full lucide namespace bundled into evaluator-owning page. Acceptable for studio.
- Model must remember v1 renames (Home→House etc.) — mitigated in prompt
