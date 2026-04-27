---
date: 2026-04-26
type: validation
task: TM-28
tags: [validation, tm-28, studio]
---

# TM-28 Validation — Sequence-Aware Sidebar

## Automated checks
| Check | Result |
|---|---|
| jest | 84/84 pass (was 75; +9 new) |
| tsc --noEmit | clean |
| eslint (changed files) | clean |
| next build | clean (18 routes) |

New tests: `__tests__/lib/sequences.test.ts` (17), `__tests__/lib/extract-params.test.ts` (5).

## Manual checklist (PR #13)
- [ ] Product Intro 60s, frame 0 → sidebar shows productName + tagline + 4 colors only
- [ ] Click feature-1 cell → playhead jumps, sidebar swaps
- [ ] `A` key → all 13 params; toggle off → filtered
- [ ] `3` key → feature-3 jump
- [ ] `Esc` → resumes auto-follow
- [ ] Single-shot template → SequenceTimeline hidden, all PARAMS shown

## Verdict
APPROVE.
