# TM-46 Screenshots

This directory holds screenshots captured during TM-46 visual LLM-as-judge runs.

- Filename pattern: `<prompt-id>-<frame>.png` (e.g. `dv-01-60.png`).
- Frames captured: 60 (1s @30fps), 90 (mid), 180 (end).
- Source: Playwright MCP `browser_take_screenshot` against
  `http://localhost:3046/studio?asset=<id>&frame=<n>`.

The actual binary screenshots are NOT committed to git in the initial TM-46 PR
(infrastructure-only). They will be added in the TM-46-r2 follow-up iteration
once a full-run completes.

For pipeline dry-runs, see `__tests__/benchmarks/tm-46-smoke-fixture.ts` which
generates 1×1 placeholder PNGs under `__tests__/benchmarks/results/tm-46/screenshots/`.
