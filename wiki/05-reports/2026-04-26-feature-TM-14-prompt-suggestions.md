# TM-14 — AI Prompt Suggestions (rotating empty-state cards)

**Branch**: `TM-14-prompt-suggestions` @ `fc2f248`
**Type**: feature, complexity 3, P2

## What shipped
- `src/lib/prompt-suggestions.ts` — 50-prompt static pool × 5 categories with `pickDiversifiedSuggestions(count, seed)` (mulberry32 LCG + round-robin, dedup, deterministic)
- `src/components/studio/PromptPanel.tsx` — replaced 3 hardcoded chips with 4-card grid (category badge + label, prompt in title attr). Gated on empty input + no asset + no clarify. Click sets prompt + auto-focus. Shuffle reseeds.
- 12 new unit tests

## Verification
- jest 99/99 pass, tsc clean, eslint clean

## Decisions
- Static pool (no LLM cost, instant) — generation cost reserved for actual run
- Seeded picker over scattered `Math.random` — Shuffle visible reroll, picker pure-testable
- 4 cards, 2-col grid (spec 3-5, 4 maximizes coverage)
