#!/usr/bin/env bash
# setup-worktree.sh — Bootstrap an EasyMake git worktree for parallel agent dev.
#
# Usage:
#   bash scripts/setup-worktree.sh <worktree_path> <dev_port> [hostname]
#
# What it does (idempotent):
#   1) Copies main repo's .env.local into <worktree_path>/.env.local
#   2) Sets NEXTAUTH_URL=http://<hostname>:<dev_port>.
#      hostname defaults to `127.0.0.1` (NOT `localhost`) — see TM-65 below.
#   3) Runs `npx prisma db push --schema <worktree_path>/prisma/schema.prisma --skip-generate`
#      using DATABASE_URL=file:./dev.db (worktree-relative) so each worktree gets its own SQLite DB.
#   4) Runs `npx prisma generate --schema <worktree_path>/prisma/schema.prisma` so the worktree
#      gets its own generated Prisma client at <worktree>/node_modules/.prisma/client. Without
#      this, an empty worktree node_modules causes module resolution to fall back to the main
#      repo's generated client (TM-46 r6 retro: dev server in worktree opened main's
#      `prisma/dev.db`, accumulating monthly-limit usage on the main user).
#   5) Prints a completion banner with paths/ports.
#
# Notes:
#   - Re-running on an already-bootstrapped worktree is safe (overwrites .env.local, db push is idempotent,
#     prisma generate is idempotent — re-emits the same client into node_modules).
#   - New deps are NOT installed here; assume the worktree was created from main with node_modules linked or
#     a separate `npm install` already run.
#   - Discovery context: TM-42/43/45 retros surfaced repeated manual env+db setup pain;
#     TM-46 r6 retro surfaced the worktree-prisma-client isolation gap fixed in TM-87.
#
# TM-65 — multi-worktree cookie isolation:
#   Browsers scope cookies by HOSTNAME, not host:port. Two dev servers both on `localhost`
#   (e.g. :3043 and :3056) therefore share a single cookie jar — a NextAuth login on one
#   port silently overwrites the session cookie used by the other, and any auth-gated
#   redirect can bounce you across worktrees. Using a different hostname per worktree
#   (e.g. main repo on `localhost`, worktree A on `127.0.0.1`, worktree B on a
#   `*.local` alias mapped via /etc/hosts) gives each its own cookie jar.
#   Default hostname here is `127.0.0.1`; pass an explicit hostname for additional
#   concurrent worktrees.

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "[setup-worktree] usage: bash scripts/setup-worktree.sh <worktree_path> <dev_port> [hostname]" >&2
  exit 64
fi

WORKTREE_PATH="$1"
DEV_PORT="$2"
DEV_HOST="${3:-127.0.0.1}"

# Hostname sanity check — letters, digits, dot, hyphen only. Reject anything weird so we
# don't silently produce a malformed NEXTAUTH_URL.
if [[ ! "$DEV_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "[setup-worktree] hostname must match [A-Za-z0-9.-]+, got: $DEV_HOST" >&2
  exit 64
fi

if [[ ! "$DEV_PORT" =~ ^[0-9]+$ ]]; then
  echo "[setup-worktree] dev_port must be numeric, got: $DEV_PORT" >&2
  exit 64
fi

# Resolve absolute paths.
if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "[setup-worktree] worktree path does not exist: $WORKTREE_PATH" >&2
  exit 66
fi
WORKTREE_PATH="$(cd "$WORKTREE_PATH" && pwd)"

# Locate main repo (the git common dir's parent — works whether invoked from main or from worktree).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Walk up to the repo root containing .env.local. The main repo always has .env.local committed-in-spirit
# (gitignored but locally present). Worktrees do NOT have it until this script runs.
MAIN_REPO=""
candidate="$SCRIPT_DIR"
while [[ "$candidate" != "/" ]]; do
  if [[ -f "$candidate/.env.local" && -d "$candidate/.git" ]]; then
    MAIN_REPO="$candidate"
    break
  fi
  candidate="$(dirname "$candidate")"
done

# Fallback: hardcoded canonical path (matches CLAUDE.md project root).
if [[ -z "$MAIN_REPO" ]]; then
  if [[ -f "/Users/kimjaehyuk/Desktop/remotion-maker/.env.local" ]]; then
    MAIN_REPO="/Users/kimjaehyuk/Desktop/remotion-maker"
  fi
fi

if [[ -z "$MAIN_REPO" || ! -f "$MAIN_REPO/.env.local" ]]; then
  echo "[setup-worktree] could not locate main repo .env.local. Aborting." >&2
  exit 70
fi

echo "[setup-worktree] main repo:   $MAIN_REPO"
echo "[setup-worktree] worktree:    $WORKTREE_PATH"
echo "[setup-worktree] dev host:    $DEV_HOST"
echo "[setup-worktree] dev port:    $DEV_PORT"

# 1) Copy .env.local
cp "$MAIN_REPO/.env.local" "$WORKTREE_PATH/.env.local"

# 2) Substitute NEXTAUTH_URL host+port AND pin DATABASE_URL to an ABSOLUTE worktree-local
#    path. The relative `file:./dev.db` form is dangerous in worktrees: Next 16 + turbopack
#    infers the workspace root from a parent lockfile and resolves the SQLite path relative
#    to the *main repo*, silently sharing the prod-like DB across worktrees. (Discovered
#    TM-76 retro 2026-04-27 — see wiki/02-dev/tech-notes/2026-04-27-worktree-database-url.md)
TMP_ENV="$WORKTREE_PATH/.env.local.tmp"
ABS_DB_URL="file:$WORKTREE_PATH/prisma/dev.db"
awk -v host="$DEV_HOST" -v port="$DEV_PORT" -v dburl="$ABS_DB_URL" '
  BEGIN { auth_replaced = 0; db_replaced = 0 }
  /^NEXTAUTH_URL=/ {
    print "NEXTAUTH_URL=http://" host ":" port
    auth_replaced = 1
    next
  }
  /^DATABASE_URL=/ {
    print "DATABASE_URL=" dburl
    db_replaced = 1
    next
  }
  { print }
  END {
    if (!auth_replaced) print "NEXTAUTH_URL=http://" host ":" port
    if (!db_replaced)   print "DATABASE_URL=" dburl
  }
' "$WORKTREE_PATH/.env.local" > "$TMP_ENV"
mv "$TMP_ENV" "$WORKTREE_PATH/.env.local"

echo "[setup-worktree] .env.local copied + NEXTAUTH_URL pinned to http://$DEV_HOST:$DEV_PORT + DATABASE_URL pinned to $ABS_DB_URL"

# 3) Prisma db push (worktree-local SQLite at <worktree>/prisma/dev.db via DATABASE_URL=file:./dev.db).
#    The schema file in the worktree controls the migration; --skip-generate avoids regenerating client
#    (the worktree shares node_modules in most setups).
SCHEMA_PATH="$WORKTREE_PATH/prisma/schema.prisma"
if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "[setup-worktree] prisma/schema.prisma not found at $SCHEMA_PATH — skipping db push" >&2
else
  pushd "$WORKTREE_PATH" >/dev/null
  # Use absolute path to match what we wrote to .env.local (avoids cwd-relative drift).
  DATABASE_URL="$ABS_DB_URL" npx --yes prisma db push --schema "$SCHEMA_PATH" --skip-generate
  popd >/dev/null
  echo "[setup-worktree] prisma db push OK ($WORKTREE_PATH/prisma/dev.db)"

  # 4) Prisma generate — emit a worktree-local generated client into <worktree>/node_modules/.prisma/client.
  #    Without this the worktree's empty node_modules causes Node module resolution to walk up to the main
  #    repo's node_modules and load main's generated client. Worse, `prisma generate` itself walks up to
  #    locate `@prisma/client` and emits the new client into MAIN's `node_modules/.prisma/client`, so a
  #    worktree generate silently overwrites main's client. Per TM-46 r6 retro this caused the worktree
  #    dev server to effectively share main's runtime — including main's `prisma/dev.db` — and burn the
  #    main user's monthly OpenAI usage cap.
  #
  #    Fix: seed the worktree's node_modules with copies of main's `@prisma/` and `.prisma/` directories
  #    BEFORE running `prisma generate`. Once `@prisma/client` exists locally, `prisma generate`'s walk
  #    stops in the worktree and emits the client into the worktree's own `node_modules/.prisma/client`.
  #    Idempotent: cp -R overwrites, prisma generate is overwrite-safe.
  MAIN_PRISMA_PKG="$MAIN_REPO/node_modules/@prisma"
  MAIN_PRISMA_GEN="$MAIN_REPO/node_modules/.prisma"
  WORKTREE_NM="$WORKTREE_PATH/node_modules"
  if [[ -d "$MAIN_PRISMA_PKG" ]]; then
    mkdir -p "$WORKTREE_NM"
    # Remove existing worktree-local copies first so cp -R is deterministic across re-runs.
    rm -rf "$WORKTREE_NM/@prisma" "$WORKTREE_NM/.prisma"
    cp -R "$MAIN_PRISMA_PKG" "$WORKTREE_NM/@prisma"
    if [[ -d "$MAIN_PRISMA_GEN" ]]; then
      cp -R "$MAIN_PRISMA_GEN" "$WORKTREE_NM/.prisma"
    fi
    pushd "$WORKTREE_PATH" >/dev/null
    DATABASE_URL="file:./dev.db" npx --yes prisma generate --schema "$SCHEMA_PATH"
    popd >/dev/null
    echo "[setup-worktree] prisma generate OK ($WORKTREE_PATH/node_modules/.prisma/client)"
  else
    echo "[setup-worktree] main repo has no node_modules/@prisma — skipping local prisma generate" >&2
    echo "[setup-worktree] worktree dev server will fall back to main's generated client (TM-46 r6 risk)" >&2
  fi
fi

echo ""
echo "[setup-worktree] DONE"
echo "  worktree:     $WORKTREE_PATH"
echo "  NEXTAUTH_URL: http://$DEV_HOST:$DEV_PORT"
echo "  next steps:   cd $WORKTREE_PATH && PORT=$DEV_PORT HOSTNAME=$DEV_HOST npm run dev"
echo "                # then open http://$DEV_HOST:$DEV_PORT in the browser"
echo "                # (TM-65: distinct hostname keeps cookies isolated from other worktrees)"
