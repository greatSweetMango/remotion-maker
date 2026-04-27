# 2026-04-26 — feature — TM-22 Lucide icon library

**PR**: https://github.com/greatSweetMango/remotion-maker/pull/18
**Diff**: +293/-5 across 8 files
**ADR**: 0011 (lucide runtime injection)

## What changed
- Evaluator injects `lucide` (lucide-react namespace) as third factory arg alongside `React` and `remotion`
- Sandbox sanitizer strips `import ... from 'lucide-react'` (defense in depth)
- `Parameter['type']` gains `'icon'`; `extract-params` parses `// type: icon` as string-valued param
- `ParameterControl` renders popover icon picker for `type: 'icon'` — search box + 6-col grid backed by `src/lib/lucide-catalog.ts` (52 entries, tag-indexed)
- Generation system prompt gets ICONS section showing destructure pattern + dynamic `lucide[icon]` lookup

## Verification
- tsc clean, jest 122/122 (+9), eslint clean on touched files
- Lucide v1 renames in catalog/prompt: Home→House, Unlock→LockOpen, BarChart3→ChartBar, PieChart→ChartPie

## Follow-ups
- Manual smoke: generate "별 아이콘 회전" → picker + swap + export
- Lazy-load lucide bundle if studio bloats
