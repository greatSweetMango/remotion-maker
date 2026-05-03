---
title: "TM-96 — Prisma `file:./dev.db` resolves into node_modules, creates empty rogue DB"
date: 2026-04-27
tags: [tech-note, prisma, sqlite, next16, turbopack, gotcha]
related: [TM-76, TM-83, TM-87]
---

# TM-96 — Prisma `file:./dev.db` resolves into node_modules, creates empty rogue DB

## Symptom

P0 user-blocking: dev server on **main** repo throws on `/dev-login`:

```
PrismaClientKnownRequestError
The table `main.User` does not exist in the current database.
src/app/dev-login/actions.ts (12:38)
```

Yet `prisma/dev.db` on disk is 2.3 MB with all 8 tables (User, Asset, Account,
AssetVersion, Subscription, Session, UploadedAsset, VerificationToken) and a
populated User row.

## Root cause

`lsof | grep dev.db` revealed the dev server (Next.js + Prisma) was holding
**a different** SQLite file:

```
node      78437 …  /Users/…/remotion-maker/node_modules/.prisma/client/dev.db   (0 bytes)
```

Two `dev.db`s existed:

| Path | Size | Tables |
|---|---|---|
| `prisma/dev.db` (intended) | 2,355,200 B | 8 |
| `node_modules/.prisma/client/dev.db` (rogue) | 0 B | 0 |

`.env` / `.env.local` had `DATABASE_URL="file:./dev.db"`. Prisma's SQLite
engine subprocess resolved the relative path against the engine binary's CWD,
which under Next 16 + Turbopack was the generated client directory inside
`node_modules/.prisma/client/`, not the project root. The engine cheerfully
auto-created an empty `dev.db` there on first connect — every subsequent query
ran against an empty database.

This is the same workspace-root inference class of bug surfaced in TM-76
(worktree DB_URL drift) and TM-87 (worktree prisma generate cross-pollination).
TM-87's `setup-worktree.sh` already pins **worktrees** to absolute
`DATABASE_URL`. Main was still on relative.

## Fix

Two layers, both shipped in TM-96:

### 1. Runtime guard in `src/lib/db/prisma.ts`

Before `new PrismaClient()`, normalize `process.env.DATABASE_URL`:

- if it starts with `file:` and the path is relative → resolve against
  `process.cwd()` (always project root in Next.js server) and rewrite to
  absolute.
- log a warning when a rogue empty DB is detected at the wrong CWD.

This makes the bug self-healing regardless of how `.env` is written.

### 2. Local main `.env` / `.env.local` pinning

For the user's already-running dev server (no PR needed for gitignored env
files):

```
DATABASE_URL="file:/Users/kimjaehyuk/Desktop/remotion-maker/prisma/dev.db"
```

And delete the rogue empty file:

```
rm /Users/kimjaehyuk/Desktop/remotion-maker/node_modules/.prisma/client/dev.db
```

Restart the dev server.

## Detection / verification

```
lsof | grep dev.db
```

The Node dev process should hold an fd into `…/prisma/dev.db` (project-level),
**never** `…/node_modules/.prisma/client/dev.db`. If you ever see the latter,
the bug has reappeared — check `process.cwd()` of the engine and `DATABASE_URL`.

```
sqlite3 prisma/dev.db ".tables"
```

Should list 8 tables. An empty rogue file at the wrong path lists none.

## Don't repeat

- Never use `file:./dev.db` (relative) for SQLite Prisma URLs in this repo.
  Always absolute, always pinned. The runtime guard is a safety net, not a
  license to be relative.
- When `setup-worktree.sh` evolves, keep the `ABS_DB_URL=file:$WORKTREE_PATH/prisma/dev.db`
  pin (TM-76) — do not regress to `file:./dev.db`.
- After any `prisma generate` re-emit, `node_modules/.prisma/client/dev.db`
  should not exist. If it does, delete it.

## See also

- `wiki/05-reports/2026-04-27-TM-96-fix.md` (RCA + retro)
- `scripts/setup-worktree.sh` lines 102–129 (worktree absolute URL pin, TM-76)
- `src/lib/db/prisma.ts` (TM-96 runtime guard)
