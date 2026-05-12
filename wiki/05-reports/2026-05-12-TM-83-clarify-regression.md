---
title: "TM-83 — prompt-clarify regression QA (PR #127 b2f955c)"
date: 2026-05-12
type: qa
task: TM-83
tags: [qa-ai, clarify-gate, skeleton-detector, regression]
verdict: APPROVE
---

# TM-83 — prompt-clarify regression QA

**Target**: PR #127 (b2f955c) — visual-domain gate in `clarify-gate.ts` + skeleton-echo detector in `generate.ts`.
**Driver**: `scripts/qa/tm-83-clarify-regression.mjs`
**Corpus**: 14 prompts × 1 `/api/generate` call (OpenAI live).
**Total wall-clock**: ~2 min (avg ~8.7 s/prompt).

## Acceptance (primary)

| Criterion | Threshold | Actual | Pass |
|---|---|---|---|
| Overall accuracy | ≥ 90% | **93%** (13/14) | yes |
| Character/Scene → clarify | ≥ 86% (≥ 6/7) | **100%** (7/7) | yes |
| Motion-graphics → generate | 100% | **100%** (5/5) | yes |
| Skeleton-echo hits in generated code | 0 | **0** | yes |

**Verdict**: APPROVE. PR #127 stable across all primary axes.

## Acceptance (secondary)

| Criterion | Threshold | Actual | Pass |
|---|---|---|---|
| Style-specified character → generate | 100% (2/2) | 50% (1/2) | partial — see notes |

## Per-prompt results

### Character/Scene (clarify expected) — 7/7 pass

| ID | Prompt | Got | Latency |
|---|---|---|---|
| C1 | 곰돌이 캐릭터가 초원을 걸어가는 10초가량의 애니메이션 만들어줘 | clarify | 6.7s |
| C2 | 강아지가 공을 쫓아가는 애니메이션 | clarify | 7.5s |
| C3 | 용이 하늘을 나는 장면 5초 | clarify | 7.4s |
| C4 | 사람이 춤추는 영상 | clarify | 6.3s |
| C5 | 공룡이 숲을 걸어가는 애니메이션 10초 | clarify | 10.3s |
| C6 | person walking in a forest, 8 seconds | clarify | 6.1s |
| C7 | a cat playing with yarn | clarify | 5.3s |

C1 (the PR #127 reproducer prompt) and 6 sibling prompts all correctly route to `clarify`. The visual-domain gate is doing its job: bare subject + duration (no color/style/count/data) does NOT trip `isConcrete`, so the LLM's clarify decision is respected instead of being overridden by the TM-52 force-generate retry.

### Motion-graphics (generate expected) — 5/5 pass

| ID | Prompt | Got | Code len | PARAMS keys | Latency |
|---|---|---|---|---|---|
| M1 | Animated counter from 0 to 100 with spring effect | generate | 1691 | 6 | 5.1s |
| M2 | 빨간 카운터 0~100, 3초 | generate | 1914 | 6 | 6.8s |
| M3 | 원형 스피너 8개 점, 파란색 | generate | 2226 | 8 | 13.5s |
| M4 | Comic book POW! text exploding outward | generate | 1488 | 5 | 15.5s |
| M5 | 타이핑 효과 "Hello World", 모노스페이스 | generate | 1928 | 6 | 5.6s |

No skeleton-echo markers detected. PARAMS extraction yields 5-8 keys in all cases (well above the empty-stub baseline). M3's 8-key output matches the explicit entity count "8개 점" (TM-68 entity-count gate working).

### Style-specified character (generate expected) — 1/2

| ID | Prompt | Got | Code len | Latency |
|---|---|---|---|---|
| S1 | 픽셀아트 곰돌이가 걷는 10초 애니메이션 | generate | 1309 | 17.7s |
| S2 | low-poly 3D dragon flying | **clarify** | — | 7.0s |

**S1** passes: "픽셀아트" matches KO style pattern, "곰돌이" matches subject Korean noun list (no — "곰돌이" not in list; "걷는" gives action context; KO bias compensation + length push score ≥ 2; visual-domain via style).

**S2** misses: "low-poly" is not in `STYLE_PATTERNS`; "3D" alone matches the `3d` pattern → 1 style hit. "dragon" is not in EN `SUBJECT_PATTERNS`. "flying" is not a style/data/color signal. Score = 1, below `CONCRETENESS_THRESHOLD=2`, so the LLM's clarify decision stands.

**Assessment**: This is a corpus design edge, not a PR #127 regression. The prompt is genuinely sparse in concrete signals — no color, no count, no canonical-named style (only "3D"), no quoted copy. A defensible clarify decision. Two paths forward, neither required for TM-83 APPROVE:
- (option A) Extend `STYLE_PATTERNS` with `low-poly`, `voxel`, `cel-shaded`, `flat-shaded`, `claymation`, `toon`, `cartoon`. Low cost.
- (option B) Add common creature subjects (dragon/cat/dog/bear) to `SUBJECT_PATTERNS` so even sparse style-character prompts cross threshold.

If we want either, file a separate ticket (AI-BUG-clarify-low-poly). For TM-83 the global ≥90% acceptance is met (93%), and 0 character/scene regressions confirm PR #127 fix is healthy.

## Skeleton-echo detector

Zero skeleton-comment markers (`// Complete TSX code here`, `{/* component content */}`, `// ... all params`, `// animation logic`) appeared in any of the 7 generated code outputs. Detector is dormant in normal traffic, as intended (it's a defensive net for the dv-05-class failure mode).

## OpenAI cost estimate

14 calls × avg ~1.5k input tokens + ~1.2k output (clarify is cheap, generate ~2k out). Approx 35k total tokens. At gpt-4o-mini pricing tier (~$0.15 / 1M input, $0.60 / 1M output): well under $0.05.

## Artifacts

- Driver: `scripts/qa/tm-83-clarify-regression.mjs`
- Raw results: `wiki/05-reports/screenshots/TM-83/results.json`
- Summary JSON: `wiki/05-reports/screenshots/TM-83/summary.json`

## Notes / follow-ups

- PR #127 is healthy on the primary axis. **APPROVE.**
- Optional follow-up: file `AI-BUG-clarify-low-poly-dragon` (low priority) to extend STYLE/SUBJECT patterns for sparse English style-character prompts. Not blocking.
