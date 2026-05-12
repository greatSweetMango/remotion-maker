# mcp-llm-judge (TM-103 scaffold)

MCP stdio server that exposes **LLM-as-judge** as two reusable tools:

- `judge_visual(image_url, criteria?, model?)` — grade an image on 4 axes
  (`clarity`, `fidelity`, `aesthetic`, `intent_match`). Defaults to
  `gpt-4o` (multimodal).
- `judge_code(code, criteria?, model?)` — grade a code snippet on 4 axes
  (`correctness`, `style`, `safety`, `intent_match`). Defaults to
  `gpt-4o-mini` (cheap).

Both tools return:

```ts
interface JudgeResult<Scores> {
  scores: Scores;              // each axis 1-10
  reasoning: string;           // 1-3 sentences from the judge
  raw_response: string;        // unparsed model output (debug)
  overall: number;             // 0-100, derived = round(avg(axes) * 10)
  needs_review: boolean;       // true if any axis < 6
}
```

## Why this exists

The visual-judge infra evolved inside `__tests__/benchmarks/tm-46-judge.ts`
(TM-46 → TM-66 OpenAI migration). It works, but it's bench-script-shaped:
hard-coded to the TM-46 prompt set, the TM-46 rubric, and the TM-46 output
JSON layout. Other tasks (TM-108 capture, TM-111 callsite migration,
future TM-100 quality-judge agent) want **the same determinism and rubric
shape** without copying 300 lines of bench harness.

This MCP server standardises:

- **Determinism** — every call pins `temperature=0` + `seed=42` per
  ADR-0017 (capture) and ADR-0018 (judge). TM-70 RCA showed default-
  temperature runs drift ±10 points on identical input — larger than the
  noise floor we care about for acceptance gating.
- **Schema** — 4-axis rubric + 0-100 overall + `needs_review` gating
  signal. Same shape for visual and code judges so callers can write a
  single result handler.
- **Transport** — MCP stdio so any agent (Claude Code, sub-agents,
  Orchestrator scripts) can call it without a bespoke HTTP server.

## Tools

### `judge_visual`

```jsonc
{
  "image_url": "data:image/png;base64,iVBOR...",  // or https URL
  "criteria": "User wanted a teal gradient background.",  // optional
  "model": "gpt-4o"  // optional; default gpt-4o
}
```

### `judge_code`

```jsonc
{
  "code": "const Hello = () => <div>hi</div>;",
  "criteria": "Should export a React component named `Hello`.",  // optional
  "model": "gpt-4o-mini"  // optional; default gpt-4o-mini
}
```

## Registering with `.mcp.json`

After `npm install && npm run build` in this directory, add to project
root `.mcp.json`:

```json
{
  "mcpServers": {
    "llm-judge": {
      "command": "node",
      "args": ["./plugin/llm-judge/dist/server.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  }
}
```

Or run from source during development:

```json
{
  "mcpServers": {
    "llm-judge": {
      "command": "npx",
      "args": ["tsx", "./plugin/llm-judge/src/server.ts"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  }
}
```

Tools then appear as `mcp__llm-judge__judge_visual` and
`mcp__llm-judge__judge_code` to Claude Code / any MCP host.

## Environment

- `OPENAI_API_KEY` — required. Reads from process env; the server fails
  loudly on `CallTool` if missing.

## Tests

```bash
cd plugin/llm-judge
npm install
npm test
```

Uses Node's built-in `node:test` runner + `tsx`. The OpenAI client is
mocked via a minimal `ChatLikeClient` interface, so the unit suite is
hermetic — no API key, no network.

## Why a separate sub-package?

Same reasoning as `plugin/remotion-eval` (TM-102):

- **Isolation** — MCP server runs in a fresh Node process. Pulling the
  whole Next.js app graph into the MCP process would balloon startup.
- **Minimal deps** — only `@modelcontextprotocol/sdk` + `openai`.
- **No app coupling** — judge core is self-contained. The TM-66 bench
  script remains the source-of-truth implementation until TM-111 migrates
  the callsite, at which point this package becomes canonical.

## Follow-ups (not in this PR)

- **TM-111** — migrate `__tests__/benchmarks/tm-46-judge.ts` (the TM-66
  callsite) to call this MCP tool instead of OpenAI directly. Out of
  scope here per task spec ("실제 TM-66 마이그레이션은 TM-111로 분리").
- Multi-image batch (`judge_visual_batch`) for the 3-frame-per-prompt
  pattern TM-46 uses today.
- Wire `ai-quality-judge` subagent (TM-100) to call `judge_visual` /
  `judge_code` as its default scoring tools.

## Related ADRs

- [ADR-0017](../../wiki/01-pm/decisions/0017-capture-determinism.md) —
  Capture-side determinism (`temperature=0`, `seed=42`).
- [ADR-0018](../../wiki/01-pm/decisions/0018-judge-determinism.md) —
  Judge-side determinism + N-shot policy.
