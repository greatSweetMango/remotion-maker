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
> Generated at `2026-05-12T17:06:45.439Z`.

## Throughput

- **Merged PRs (window):** 55
- **Average cadence:** 3h / PR

| PR | when | subject |
|---|---|---|
| #157 | 2026-05-13 | qa(judge): TM-111 visual-judge migrate to ai-quality-judge agent + judge-acceptance skill (#157) |
| #156 | 2026-05-13 | docs(agents): TM-116 wire remotion-validator → mcp__remotion-eval (#156) |
| #155 | 2026-05-13 | feat(mcp): TM-114 add extract_params tool to mcp-remotion-eval (#155) |
| #154 | 2026-05-13 | feat(ux): TM-91 image-gen progressive latency UX (38s p50) (#154) |
| #153 | 2026-05-13 | feat(infra): TM-117 wire CLAUDE_TASK_ID / current-task for spend-ledger (#153) |
| #152 | 2026-05-13 | test(ci): TM-115 add MCP remotion-eval deny-list sync guard (#152) |
| #151 | 2026-05-13 | feat(hooks): TM-112 spend-ledger appender — cost_burst signal live (#151) |
| #150 | 2026-05-13 | feat(mcp): TM-103 mcp-llm-judge server scaffold + judge_visual/judge_code tools (#150) |
| #149 | 2026-05-13 | feat(orchestrator): TM-113 verdict-history.jsonl append hook (#149) |
| #148 | 2026-05-13 | feat(ai): TM-88 PARAMS type:image regen-prompt UI (ADR-0022 follow-up) (#148) |
| #147 | 2026-05-13 | feat(dashboard): TM-104 weekly roll-up script + launchd cron (#147) |
| #146 | 2026-05-13 | feat(mcp): TM-102 mcp-remotion-eval server scaffold + validate_remotion_code tool (#146) |
| #145 | 2026-05-13 | feat(agents): TM-100 ai-quality-judge specialized TeamLead + judge-acceptance skill (#145) |
| #144 | 2026-05-13 | feat(orchestrator): TM-101 night-mode STOP guard + spend-ledger format (#144) |
| #143 | 2026-05-13 | feat(agents): TM-99 remotion-validator agent + PM router (#143) |
| #142 | 2026-05-13 | feat(orchestrator): TM-97 spawned-task canonical ID reservation (#142) |
| #141 | 2026-05-13 | refactor(deps): TM-110 dead-code week 1 — drop 12 unused direct deps (#141) |
| #140 | 2026-05-13 | feat(agents): TM-98 ai-prompt-tuner specialized TeamLead (#140) |
| #139 | 2026-05-13 | qa(TM-106): TM-85 r2 re-bench — 30/30 mode_match, data-viz fix verified (#139) |
| #138 | 2026-05-13 | fix(orchestrator): TM-96 branch-locks mutex + pre-pr.sh duplicate guard (#138) |

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

### Per-task cost (last 7d, top 10)

_(no per-task spend in window)_

### Per-model cost (last 7d, top 10)

_(no per-model spend in window)_

### Daily spend trend (last 7d)

_(no daily spend in window)_

## Agent verdicts

- **Total verdicts (window):** 0
- **APPROVE:** 0 / **REQUEST_CHANGES:** 0 / **BLOCK:** 0 / **OTHER:** 0
- **Escalate rate:** — (0 escalated)
- **Bad rate (REQUEST_CHANGES + BLOCK):** —

---

_Sources: `git log`, `wiki/05-reports/screenshots/*/summary*.json`, `.agent-state/spend.json`, `.agent-state/spend-ledger.jsonl`, `.agent-state/verdict-history.jsonl`._
