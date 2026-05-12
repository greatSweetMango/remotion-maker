# mcp-remotion-eval (scaffold)

MCP stdio server that validates LLM-generated Remotion component code.
Wraps the in-app deny-list (`src/lib/remotion/sandbox.ts`) and transpiler
(`src/lib/remotion/transpiler.ts`) into a portable, agent-callable tool.

**Status**: TM-102 scaffold — single tool, single PR. Larger surface
(`extract_params`, `lint_adr_compliance`, render-budget dry-run) tracked as
follow-up tasks.

## Tool

### `validate_remotion_code(code: string)`

Runs:

1. **Deny-list** — `eval`, `Function`, `fetch`, `setTimeout`, `Reflect`,
   `Proxy`, `WebAssembly`, `for(;;)`, `while(true)`, recursive Promise
   chains, etc. (matches `sandbox.ts` deny-list as of TM-85.)
2. **Structural checks** — `const PARAMS = {...}` declared (ADR-0002),
   at least one PascalCase component declaration. Reported as
   `warnings[]` (not hard failures) so callers pick policy.
3. **Transpile** — sucrase TS+JSX → JS, classic JSX runtime. Skipped if
   the deny-list already failed.

Returns:

```ts
interface ValidateResult {
  ok: boolean;            // false if any error in errors[]
  errors: string[];       // categorical strings, e.g. "Forbidden: eval"
  warnings: string[];     // structural advisories
  transpiled: string | null;
  paramsCount: number;    // 0 when no PARAMS const present
}
```

The MCP `CallToolResult` sets `isError: true` whenever `ok === false`, so
hosts that auto-surface errors render the failure inline.

## Registering with `.mcp.json`

After `npm install && npm run build` in this directory, add to the project
root `.mcp.json`:

```json
{
  "mcpServers": {
    "remotion-eval": {
      "command": "node",
      "args": ["./plugin/remotion-eval/dist/server.js"]
    }
  }
}
```

Or run from source during development:

```json
{
  "mcpServers": {
    "remotion-eval": {
      "command": "npx",
      "args": ["tsx", "./plugin/remotion-eval/src/server.ts"]
    }
  }
}
```

Once registered, the tool appears as `mcp__remotion-eval__validate_remotion_code`
to Claude Code / any MCP host.

## Tests

```bash
cd plugin/remotion-eval
npm install
npm test
```

Uses Node's built-in `node:test` runner + `tsx` for TS — no jest, no
project-wide test config coupling.

## Why a separate sub-package?

- **Isolation** — MCP server runs in a fresh Node process. Pulling the
  whole Next.js app graph (React, Prisma, Stripe, ...) into the MCP
  process would balloon startup time and CSP surface.
- **Minimal deps** — only `@modelcontextprotocol/sdk` + `sucrase`.
- **No app coupling** — validation core is duplicated rather than
  imported via `@/` alias, intentionally. If the in-app deny-list drifts,
  follow-up TM-XXX will add a sync test that diffs the two lists.

## Follow-ups (not in this PR)

- Tool: `extract_params(code)` — reuse `src/lib/ai/extract-params.ts`
  semantics to return typed parameter metadata.
- Tool: `dry_render_budget(code, durationFrames)` — heuristic cost
  estimate before invoking Remotion Lambda.
- Sync test: assert sub-package deny-list ≡ app deny-list.
- Wire `remotion-validator` subagent (TM-99) to call this MCP tool.
