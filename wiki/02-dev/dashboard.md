---
title: Dashboard (auto)
updated: 2026-05-12
window_days: 7
generated_by: scripts/dashboard/roll-up.mjs
tags: [dev, dashboard, auto]
status: active
---

# Dashboard — last 7 days

> Auto-generated. Do not edit by hand — re-run `node scripts/dashboard/roll-up.mjs`.
> Generated at `2026-05-12T16:32:33.190Z`.

## Throughput

- **Merged PRs (window):** 43
- **Average cadence:** 3.8h / PR

| PR | when | subject |
|---|---|---|
| #145 | 2026-05-13 | feat(agents): TM-100 ai-quality-judge specialized TeamLead + judge-acceptance skill (#145) |
| #144 | 2026-05-13 | feat(orchestrator): TM-101 night-mode STOP guard + spend-ledger format (#144) |
| #143 | 2026-05-13 | feat(agents): TM-99 remotion-validator agent + PM router (#143) |
| #142 | 2026-05-13 | feat(orchestrator): TM-97 spawned-task canonical ID reservation (#142) |
| #141 | 2026-05-13 | refactor(deps): TM-110 dead-code week 1 — drop 12 unused direct deps (#141) |
| #140 | 2026-05-13 | feat(agents): TM-98 ai-prompt-tuner specialized TeamLead (#140) |
| #139 | 2026-05-13 | qa(TM-106): TM-85 r2 re-bench — 30/30 mode_match, data-viz fix verified (#139) |
| #138 | 2026-05-13 | fix(orchestrator): TM-96 branch-locks mutex + pre-pr.sh duplicate guard (#138) |
| #137 | 2026-05-13 | feat(orchestrator): TM-94 recurring refactor scheduler — 3-day cadence, 6-area rotation (#137) |
| #136 | 2026-05-13 | fix(ai): TM-95 narrow clarify rule — living-entity only (data-viz regression) (#136) |
| #135 | 2026-05-13 | feat(dashboard): TM-87 user asset management — rename + duplicate (delete shipped earlier) (#135) |
| #134 | 2026-05-13 | docs(meta): TM-93 agent workflow tooling ADR — 6 tracks, 10 follow-ups (#134) |
| #132 | 2026-05-13 | qa(TM-85): pipeline quality bench — 30 prompts, character/motion-graphics 100%, data-viz 0% regression (#132) |
| #131 | 2026-05-13 | fix(ai): TM-86 edit PARAMS isolation guard + driver event/change distinction (#131) |
| #130 | 2026-05-13 | feat(ai): TM-84 asset-gen spike — gpt-image-1 e2e validates ADR-0022 option B (#130) |
| #129 | 2026-05-12 | qa(TM-83): clarify regression — 14 prompts validate PR #127 fix (#129) |
| #128 | 2026-05-12 | docs(TM-82): ADR — character/scene rendering capability (image-gen + SVG hybrid) (#128) |
| #127 | 2026-05-12 | fix(ai): trigger clarify for visually-ambiguous prompts + catch skeleton-echo placeholder (#127) |
| #126 | 2026-05-12 | qa(TM-55): TM-42 edit-flow r2 — 20-set full re-baseline (OpenAI live) (#126) |
| #125 | 2026-05-12 | feat(plugin): extract agent-company harness as standalone Claude plugin (#125) |

## Quality (bench rollup)

- **Bench summaries in window:** 4
- **Avg mode_match_pct:** 92.1%
- **Trend (newest − oldest):** +7pp
- **Σ params_loss:** 0
- **Avg unintended%:** 2.6%
- **Avg latency p50 (generate):** 12905ms
- **Avg latency p50 (edit):** 7035ms

| task | file | mode_match | params_loss | unintended | gen p50 | edit p50 | verdict |
|---|---|---|---|---|---|---|---|
| TM-85 | summary-r2.json | 100% | 0 | 2.2% | 14488ms | 7513ms | APPROVE |
| TM-42 | summary.json | — | — | 3.3% | 13441ms | 6917ms | — |
| TM-85 | summary.json | 83.3% | 0 | 2.2% | 10786ms | 6676ms | REQUEST_CHANGES |
| TM-83 | summary.json | 93% | — | — | — | — | APPROVE |

## Spend

- **Ledger window total:** $0.0000 (0 entries)
- **By kind:** —
- **OpenAI cumulative (spend.json):** $0.0332
- **Weekly budget:** $200

## Agent verdicts

- **Total verdicts (window):** 0
- **APPROVE:** 0 / **REQUEST_CHANGES:** 0 / **BLOCK:** 0 / **OTHER:** 0
- **Escalate rate:** — (0 escalated)
- **Bad rate (REQUEST_CHANGES + BLOCK):** —

---

_Sources: `git log`, `wiki/05-reports/screenshots/*/summary*.json`, `.agent-state/spend.json`, `.agent-state/spend-ledger.jsonl`, `.agent-state/verdict-history.jsonl`._
