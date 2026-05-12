---
title: "TM-105 — mcp__prompt-corpus server scaffold (retro)"
created: 2026-05-13
updated: 2026-05-13
tags: [report, retro, mcp, prompt-corpus, infra, TM-105]
status: complete
---

# TM-105 — `mcp__prompt-corpus` server scaffold

## Goal

Standardise the prompt corpora used by nightly bench (TM-83) and
regression (TM-85) runs into a single MCP-served source of truth. Up
to now the lists lived inline in each bench script
(`__tests__/benchmarks/tm-46-prompts.ts`, `tm-70-judge-variance.ts`,
etc.) and drifted between revisions, breaking trend comparisons across
runs.

Mirrors the sub-package pattern from TM-102 (`plugin/remotion-eval`)
and TM-103 (`plugin/llm-judge`).

## Scope (delivered)

- New sub-package `plugin/prompt-corpus/` with independent
  `package.json`, `tsconfig.json`, `.gitignore`.
- MCP stdio server `plugin/prompt-corpus/src/server.ts` exposing two
  tools:
  - `list_corpora()` → `{ names: string[] }`
  - `get_corpus(name)` → `{ name, description, prompts: [{id, category, prompt}] }`
- Pure corpus loader in `plugin/prompt-corpus/src/corpus.ts` with an
  injectable `CorpusFs` interface (no real-disk access in unit tests).
  Strict validation: required `name`/`prompts`, category enum
  (`character | motion-graphics | data-viz | typography`), unique
  `id`s, filename ↔ in-file `name` consistency, path-traversal-safe
  name regex.
- Built-in static corpora under `corpora/`:
  - `tm-83-smoke.json` — 14 prompts (3-4 per category) for nightly
    fast-bench.
  - `tm-85-regression.json` — 30 prompts (7-8 per category) for full
    regression + visual-judge gating.
- 19 unit tests (`plugin/prompt-corpus/test/corpus.test.ts`) covering
  parser branches, FS-store happy/error paths, path-traversal
  rejection, and integration assertions on the static corpora (sizes
  + category coverage).
- README with `.mcp.json` registration snippet, env override
  (`PROMPT_CORPUS_ROOT`), and follow-up pointers.
- `.mcp.json` registration entry (`prompt-corpus` → `npx tsx
  ./plugin/prompt-corpus/src/server.ts`).

## Verification

```bash
cd plugin/prompt-corpus
npm install        # 99 packages, no audit findings
npm test           # 19/19 pass, ~150ms
npm run build      # tsc clean, dist/{corpus,server}.{js,d.ts}
node dist/server.js  # stdio smoke: list_corpora + get_corpus(tm-83-smoke) → 200
```

End-to-end MCP stdio handshake (initialize → list_corpora →
get_corpus) returns the expected JSON-RPC frames; both static corpora
are discoverable and parseable.

## Out of scope (explicit, deferred)

- **Consumer migration** — `__tests__/benchmarks/tm-46-prompts.ts`,
  `tm-70-judge-variance.ts`, and the TM-85 regression runner still
  import inline arrays. Per task spec, this PR only delivers the
  server; callsite migration is a separate task to avoid coupling
  bench refactors to MCP server stability.
- `get_corpus_subset(name, category)` for category-scoped subsets —
  callers can filter client-side today; promote to server tool if
  judges start asking for per-axis trend data.
- Versioning corpora (e.g. `tm-85-regression@v2`) — current model is
  "PR to edit JSON". Sufficient until we need rolling baselines.

## What went well

- The TM-102 / TM-103 sub-package template made scaffolding trivial:
  `package.json`, `tsconfig.json`, server boilerplate, README
  structure all copied with one-line edits.
- Filesystem injection via `CorpusFs` kept the 14 parser+store unit
  tests hermetic (no temp dirs, no fixtures). The 3 integration tests
  that *do* touch disk just point `createFsStore` at the real
  `corpora/` dir — same code path, no special "production mode".
- Strict validation up-front (category enum, unique ids, filename
  match) catches the exact class of drift TM-46 r6→r7 hit. Adding a
  malformed corpus to `corpora/` now fails loudly at first
  `get_corpus`, not silently mid-bench.

## What didn't go well

- First pass of `defaultCorpusRoot` used naive string concat after
  `replace()`, producing `/some/pkgcorpora` (no slash). Caught by the
  two assertions on `defaultCorpusRoot`. Lesson: anywhere we
  manipulate paths, use `node:path.join` even for "obvious"
  concatenation. Fixed in same session before commit.

## Source-material decisions

The category taxonomy `character | motion-graphics | data-viz |
typography` follows the TM-83/TM-85 spec. To populate the 14/30
prompts I drew on the 50-prompt master (`BENCHMARK_PROMPTS` in
`tm-3` / `params-extraction.benchmark.ts`) where the categories
overlap (data-viz, typography), and authored fresh prompts for
`character` (the master set has no character category) and remapped
`transition / loader / infographic` items into `motion-graphics`.
This gives even per-category coverage (3-4 in smoke, 7-8 in
regression) while keeping the corpora self-contained — the MCP
server has no dependency on the in-repo bench scripts.

## Follow-ups

- Migrate `tm-46-prompts.ts` + `tm-70-judge-variance.ts` to call
  `get_corpus("tm-85-regression")` (separate task).
- Add a CI step that boots `mcp-prompt-corpus` and asserts every
  built-in corpus parses + has ≥1 prompt per category. Currently
  enforced by `npm test`; lifting to CI would catch drift earlier.

## Related

- TM-102 retro: `wiki/05-reports/2026-05-13-TM-102-retro.md`
- TM-103 retro: `wiki/05-reports/2026-05-13-TM-103-llm-judge-mcp-retro.md`
- TM-46 rubric: `__tests__/benchmarks/tm-46-rubric.md`
