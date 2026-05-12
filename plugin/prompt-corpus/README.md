# mcp-prompt-corpus (TM-105)

MCP stdio server exposing **canonical prompt corpora** for nightly bench
(TM-83) and regression (TM-85) runs as two reusable tools:

- `list_corpora()` → `{ names: string[] }`
- `get_corpus(name)` → `{ name, description, prompts: [{id, category, prompt}] }`

Each prompt's `category` is one of:

```
character | motion-graphics | data-viz | typography
```

— matching the TM-83/TM-85 evaluation axes (and consistent with the
`layout / typography / motion / fidelity` rubric in `tm-46-rubric.md`).

## Why this exists

TM-83 nightly bench and TM-85 regression both need a single
source-of-truth for "which prompts do we run tonight?". Up to now this
list lived inline in each bench script (`__tests__/benchmarks/tm-46-prompts.ts`,
`tm-70-judge-variance.ts`, …) and drifted between revisions — e.g.
TM-46 r6 and r7 selected different subsets of the same 50-prompt
master list, breaking trend comparisons.

This MCP server standardises:

- **Identity** — every corpus has a stable name (`tm-83-smoke`,
  `tm-85-regression`) and frozen contents. Updating a corpus requires
  a PR.
- **Schema** — `{id, category, prompt}` per prompt, with strict
  category enum and uniqueness check at load time. Malformed JSON is
  rejected at server boot.
- **Transport** — MCP stdio, so any agent (TeamLead, Orchestrator
  scripts, sub-agents) can pull the corpus without copy-pasting.

## Built-in corpora

| Name              | Size | Use case                                              |
| ----------------- | ---- | ----------------------------------------------------- |
| `tm-83-smoke`     | 14   | Nightly fast-bench (target <10min). 3-4 per category. |
| `tm-85-regression`| 30   | Full regression + visual-judge gating. 7-8 per cat.   |

Add new corpora by dropping a JSON file in `corpora/`. Shape:

```jsonc
{
  "name": "tm-83-smoke",
  "description": "...",
  "prompts": [
    { "id": "char-01", "category": "character",       "prompt": "..." },
    { "id": "mg-01",   "category": "motion-graphics", "prompt": "..." },
    { "id": "dv-01",   "category": "data-viz",        "prompt": "..." },
    { "id": "ty-01",   "category": "typography",      "prompt": "..." }
  ]
}
```

The filename (sans `.json`) must match the in-file `name` field, and
all `id`s within a corpus must be unique. The loader enforces both.

## Tools

### `list_corpora`

```jsonc
// args: {}
// returns:
{ "names": ["tm-83-smoke", "tm-85-regression"] }
```

### `get_corpus`

```jsonc
// args:
{ "name": "tm-83-smoke" }
// returns:
{
  "name": "tm-83-smoke",
  "description": "...",
  "prompts": [
    { "id": "char-01", "category": "character", "prompt": "..." },
    ...
  ]
}
```

Throws `corpus "<name>" not found` for missing names. Corpus name is
validated against `/^[a-z0-9][a-z0-9\-_]*$/i` to defeat path-traversal.

## Registering with `.mcp.json`

Run from source during development (already wired in the project root
`.mcp.json`):

```json
{
  "mcpServers": {
    "prompt-corpus": {
      "command": "npx",
      "args": ["tsx", "./plugin/prompt-corpus/src/server.ts"]
    }
  }
}
```

Or after `npm install && npm run build`:

```json
{
  "mcpServers": {
    "prompt-corpus": {
      "command": "node",
      "args": ["./plugin/prompt-corpus/dist/server.js"]
    }
  }
}
```

Tools appear as `mcp__prompt-corpus__list_corpora` and
`mcp__prompt-corpus__get_corpus` to any MCP host.

## Environment

- `PROMPT_CORPUS_ROOT` — optional override for the corpora directory.
  Defaults to `<package>/corpora`. Useful for tests/staging corpora.

## Tests

```bash
cd plugin/prompt-corpus
npm install
npm test
```

Uses Node's built-in `node:test` runner + `tsx`. The filesystem is
mocked via an injected `CorpusFs` so unit tests don't touch disk; a
small set of integration tests then loads the real `corpora/*.json`
to enforce size + category-coverage invariants on the static set.

## Why a separate sub-package?

Same reasoning as `plugin/remotion-eval` (TM-102) and `plugin/llm-judge`
(TM-103):

- **Isolation** — MCP server runs in a fresh Node process; doesn't
  drag the Next.js app graph into the MCP host.
- **Minimal deps** — only `@modelcontextprotocol/sdk`.
- **No app coupling** — corpus is a data artifact, not an app feature.
  Bench scripts can migrate to call this MCP tool at their own pace.

## Follow-ups (not in this PR)

- Migrate `__tests__/benchmarks/tm-46-prompts.ts` (and the TM-85
  regression runner) to call `get_corpus` instead of importing the
  inline arrays. Out of scope per task spec ("야간 bench/regression
  테스트에서 일관된 corpus 사용" — the consumer migration is a
  separate task).
- `get_corpus_subset(name, category)` for category-scoped subsets when
  judges want per-axis trend data.
