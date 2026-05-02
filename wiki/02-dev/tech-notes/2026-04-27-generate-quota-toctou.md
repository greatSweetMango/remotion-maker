---
title: /api/generate monthly-quota TOCTOU race
date: 2026-04-27
type: tech-note
tags: [bug, race-condition, api-generate, quota, prisma]
discovered-by: TM-83
---

# /api/generate monthly-quota TOCTOU race

## Symptom

10 simultaneous POSTs to `/api/generate` from the same FREE-tier user (limit=3, current usage=0) all return 200 and all consume OpenAI tokens. After the burst the user's `monthlyUsage = 10` — well past the 3-call cap.

Reproduced by `__tests__/perf/tm-83-concurrent.mjs` on TM-83.

## Cause

`src/app/api/generate/route.ts`:

1. L30: `prisma.user.findUnique({ where: { id } })` — read `monthlyUsage`.
2. L43: `checkGenerationLimit(...)` — pure-function compare against the tier limit.
3. L55: `await generateAsset(...)` — 5–8s OpenAI call.
4. L98: `prisma.user.update({ data: { monthlyUsage: { increment: 1 } } })` — commit.

Between (1) and (4) any number of other requests can also pass the gate. The check + commit is not atomic.

## Fix sketch

Replace the read+check+commit with a single conditional update **before** the OpenAI call, then refund on error paths that don't already short-circuit:

```ts
const reserved = await prisma.user.updateMany({
  where: {
    id: user.id,
    monthlyUsage: { lt: limitForTier(user.tier) },
  },
  data: { monthlyUsage: { increment: 1 } },
});
if (reserved.count === 0) return 429;

try {
  const result = await generateAsset(...);
  // existing flow: clarify-only path already skips quota; we have to refund
  if (result.type === 'clarify') {
    await prisma.user.update({ where: { id: user.id }, data: { monthlyUsage: { decrement: 1 } } });
    return ...;
  }
  ...
} catch (e) {
  if (e instanceof AiRefusalError) {
    await prisma.user.update({ where: { id: user.id }, data: { monthlyUsage: { decrement: 1 } } });
  }
  throw e;
}
```

This keeps SQLite happy (single-statement conditional update is atomic), preserves the "no-charge-on-clarify / no-charge-on-refusal" semantics, and closes the race.

## Don't repeat

When a route reads a counter, gates on it, and increments it later, **assume concurrent requests will see the same pre-increment value**. SQLite + Prisma do not magically serialize this for you; the route handlers run in parallel on the Node event loop.

If this comes up again, the pattern is "atomic conditional update first, then do the expensive work, refund on opt-out paths."

## Related

- TM-83 perf measurement that exposed it: `wiki/05-reports/2026-04-27-TM-83-perf.md`
- ADR-0001 (edit ≠ render) — relevant because the charge point should remain at the LLM commit, not at request entry.
