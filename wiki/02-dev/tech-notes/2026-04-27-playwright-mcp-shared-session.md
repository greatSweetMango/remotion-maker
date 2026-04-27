---
title: "Playwright MCP shares one browser across parallel agents"
date: 2026-04-27
type: tech-note
tags: [playwright, mcp, agents, gotcha]
discovered_in: TM-44
---

# Playwright MCP plugin uses a singleton browser

## What we learned

The `mcp__plugin_playwright_playwright__*` tool family talks to a **single**
Chromium instance per machine. When multiple TeamLead sessions run in
parallel and each needs to drive a UI on its own dev port, every navigate
call hijacks whatever tab the browser is on — including tabs other agents
have just opened.

Symptoms observed during TM-44 (running concurrently with TM-43, TM-45,
TM-46, TM-48):

- `browser_navigate("http://localhost:3044/...")` succeeded, then
  `browser_snapshot` two seconds later returned the URL as
  `http://localhost:3043/...` because TM-43 navigated in between.
- `browser_evaluate` failed with "Execution context was destroyed, most
  likely because of a navigation" when a sibling agent triggered a
  top-frame navigation mid-call.

## Workaround

For QA tasks where round-trip *state* is the question (not visual
fidelity), prefer **Jest + React Testing Library** in jsdom. It exercises
the real components (Radix UI primitives, hooks, reducers) without needing
a browser at all, and produces deterministic, parallelizable evidence.

For tasks that genuinely require a real browser (visual diff, GPU canvas,
Remotion Player audio), the Orchestrator should serialize them — tag with
`requires: playwright-mcp` and run with `concurrency: 1`.

## jsdom polyfills needed for Radix

Tests that mount components using Radix UI's Slider/Popover/Switch need:

```ts
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
```

Consider lifting these into `jest.setup.ts` so component tests don't have
to duplicate them.

## Per-worktree dev server isolation

NextAuth's `redirectTo` defaults to `NEXTAUTH_URL` from env. Multiple
worktrees sharing `.env.local` (via symlink or copy) all redirect to the
same port. To run isolated dev servers per worktree:

```bash
cd worktrees/TM-XX-foo
PORT=30XX \
  NEXTAUTH_URL=http://localhost:30XX \
  AUTH_URL=http://localhost:30XX \
  AUTH_TRUST_HOST=true \
  npm run dev
```
