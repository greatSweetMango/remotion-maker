---
title: "TM-103 — mcp__llm-judge server scaffold (retro)"
created: 2026-05-13
updated: 2026-05-13
tags: [report, retro, mcp, llm-judge, infra, TM-103]
status: complete
---

# TM-103 — `mcp__llm-judge` server scaffold

## Goal

Standardise the LLM-as-judge infrastructure that emerged inside
`__tests__/benchmarks/tm-46-judge.ts` (TM-46 → TM-66 OpenAI migration) so
that other tasks (TM-100 ai-quality-judge subagent, TM-108 capture
quality, future TM-111 callsite migration) can reuse the same rubric,
determinism, and transport without copying 300 lines of bench harness.

Mirrors the `plugin/remotion-eval` sub-package pattern from TM-102.

## Scope (delivered)

- New sub-package `plugin/llm-judge/` (independent `package.json`,
  `tsconfig.json`, `.gitignore`).
- MCP stdio server `plugin/llm-judge/src/server.ts` exposing two tools:
  - `judge_visual(image_url, criteria?, model?)` — defaults `gpt-4o`,
    multimodal. 4 axes: `clarity`, `fidelity`, `aesthetic`, `intent_match`.
  - `judge_code(code, criteria?, model?)` — defaults `gpt-4o-mini`. 4
    axes: `correctness`, `style`, `safety`, `intent_match`.
- Pure judge core in `plugin/llm-judge/src/judge.ts` with an injectable
  `ChatLikeClient` interface (no hard OpenAI dep at the test boundary).
- 14 hermetic unit tests (`plugin/llm-judge/test/judge.test.ts`) covering
  parsing, clamping, overall derivation, determinism flags, input
  validation, criteria pass-through, noisy-JSON tolerance, default
  models.
- README with `.mcp.json` registration snippet, env vars, follow-up
  pointers.

All callers get a uniform result shape:

```ts
interface JudgeResult<Scores> {
  scores: Scores;          // each axis 1-10
  reasoning: string;       // 1-3 sentences
  raw_response: string;    // debug
  overall: number;         // 0-100 = round(avg(axes) * 10)
  needs_review: boolean;   // any axis < 6
}
```

## Out of scope (explicit, deferred)

- **TM-111** — migrate the TM-66 callsite
  (`__tests__/benchmarks/tm-46-judge.ts`) to call this MCP tool instead
  of OpenAI directly. Task spec called this out as scope-cut.
- Multi-image batch tool (`judge_visual_batch`) for the 3-frame-per-
  prompt pattern TM-46 uses. Today, callers can invoke `judge_visual`
  three times — fine for low volumes, batch helper deferred to whenever
  the cost becomes visible.
- Re-wiring `.claude/agents/ai-quality-judge.md` (TM-100) to call this
  MCP tool — that agent currently embeds its own scoring; switching it
  over is a separate small task.

## Determinism (ADRs referenced, not new)

Both tools pin `temperature=0` + `seed=42` per:

- ADR-0017 (capture-side determinism, TM-70 RCA fallout).
- ADR-0018 (judge-side determinism + N-shot policy).

A dedicated test (`judge_visual: pins temperature=0 + seed=42`) asserts
these flags on the captured request to prevent silent regressions.

No new ADR is filed — the policy already exists; this PR just lifts it
into a reusable MCP boundary.

## One bug found during test authoring

The first cut of the `clamp1to10` helper returned `0` for NaN inputs
(non-numeric judge output), violating the documented `[1, 10]` axis
range. Caught by the "clamps out-of-range and missing axes" test on the
first run. Fixed: NaN now floors to `1`, which still trips
`needs_review` and keeps the contract intact. Worth a tech-note only if
we see this pattern reappear elsewhere.

## Test plan

```bash
cd plugin/llm-judge
npm install
npm test          # 14/14 pass, hermetic (no API key, no network)
npm run build     # tsc clean
```

## Files changed

```
plugin/llm-judge/.gitignore            (new, 3 lines)
plugin/llm-judge/README.md             (new, ~140 lines)
plugin/llm-judge/package.json          (new)
plugin/llm-judge/package-lock.json     (new, auto)
plugin/llm-judge/tsconfig.json         (new)
plugin/llm-judge/src/judge.ts          (new, ~210 lines — core)
plugin/llm-judge/src/server.ts         (new, ~140 lines — MCP wrapper)
plugin/llm-judge/test/judge.test.ts    (new, ~180 lines, 14 tests)
wiki/05-reports/2026-05-13-TM-103-llm-judge-mcp-retro.md  (this file)
```

Zero changes to app source — fully isolated sub-package.

## Follow-ups (proposed)

- **TM-111** (already named in task spec): migrate `tm-46-judge.ts` to
  call `mcp__llm-judge__judge_visual` so the bench script becomes a
  thin orchestration layer.
- Optional: `judge_visual_batch(images[], criteria?)` once a real caller
  needs it.
- Optional: wire `ai-quality-judge` subagent (TM-100) to default to
  these MCP tools.

## Related

- [[2026-04-27-TM-66-visual-judge-openai|TM-66 OpenAI migration]] — the
  source-of-truth implementation this scaffold lifts.
- [[2026-05-12-TM-102-mcp-remotion-eval|TM-102 mcp-remotion-eval]] — the
  sub-package pattern this PR mirrors.
- ADR-0017 (capture determinism) / ADR-0018 (judge determinism).
