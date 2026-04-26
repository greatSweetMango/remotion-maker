<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Project knowledge base — read before working

This repo has an Obsidian-backed wiki at `wiki/` that captures **why** the code is the way it is. Code-only inspection misses: prior bugs already fixed, ADR-level decisions, current launch status. Before non-trivial work, scan the relevant pages.

Wiki access:
- Local Obsidian MCP server is registered in `.mcp.json` (SSE on `localhost:22360`) — when available, use `mcp__obsidian__*` tools.
- Otherwise just `Read` files directly under `wiki/`.

## Routing — where to look first

| Situation | Read this first |
|---|---|
| **What changed recently / what's the latest?** | `wiki/05-reports/` — session/weekly/release reports. Prioritize this. |
| Current build status, tests, in-progress work | `wiki/02-dev/status.md` |
| System architecture, stack, API routes, sandbox | `wiki/02-dev/architecture.md` |
| Why a design choice exists | `wiki/01-pm/decisions/*.md` (ADRs). Index: `wiki/01-pm/decisions/README.md` |
| Past trouble & gotchas (don't re-step on these) | `wiki/02-dev/tech-notes/*.md` |
| Product scope, personas, pricing, roadmap | `wiki/01-pm/overview.md`, `wiki/01-pm/roadmap.md` |
| Pre-launch task list & dependencies | `.taskmaster/tasks/tasks.json` (use `task-master` CLI or MCP) |
| Wiki operating rules (where to write what) | `wiki/CLAUDE.md` |
| Tag conventions | `wiki/_meta/taxonomy.md` |
| Vault home / map of content | `wiki/index.md` |

## Live ADRs (memorize)

- **ADR-0001 Edit ≠ Render** — edits are LLM-only, rendering only on Export via Remotion Lambda. Don't add server renders to the edit path.
- **ADR-0002 PARAMS auto-extract** — generated code MUST export a `PARAMS` const; the customize UI auto-binds to it. Don't change the convention without a new ADR.
- **ADR-0003 Prompt caching on edit** — `cache_control: ephemeral` on system prompt + prior code. Don't break cache key stability.

## Known gotchas (already burned us — don't repeat)

- `react-resizable-panels` v4: numeric `defaultSize={52}` = pixels, string `"52"` = percent. Use strings. (`tech-notes/2026-04-26-react-resizable-panels-v4-breaking.md`)
- evaluator's identifier-extraction regex must filter out `SCREAMING_CASE` (e.g. `PARAMS`) so it doesn't mistake constants for components. (`tech-notes/2026-04-26-evaluator-params-bug.md`)
- Next.js 16 renamed `middleware.ts` → `proxy.ts`, `experimental.serverComponentsExternalPackages` → `serverExternalPackages`. Tailwind v4 doesn't support `theme()` in CSS. Prisma is v6, not v7. (`tech-notes/nextjs-16-changes.md`)

## Writing back to the wiki

When work finishes, update wiki state instead of leaving findings only in chat:
- Material work session → write a report to `wiki/05-reports/YYYY-MM-DD-<type>-<slug>.md` (template at `wiki/_meta/templates/report.md`). The user reads this folder first.
- Architectural decision → new ADR at `wiki/01-pm/decisions/NNNN-slug.md`.
- Bug fix or library gotcha → tech-note at `wiki/02-dev/tech-notes/`.
- Live build state changed (tests, routes, major features) → update `wiki/02-dev/status.md`.

Full wiki operating rules: `wiki/CLAUDE.md`.
