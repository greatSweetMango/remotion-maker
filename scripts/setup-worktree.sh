#!/usr/bin/env bash
# setup-worktree.sh — Bootstrap an EasyMake git worktree for parallel agent dev.
#
# Usage:
#   bash scripts/setup-worktree.sh <worktree_path> <dev_port>
#
# What it does (idempotent):
#   1) Copies main repo's .env.local into <worktree_path>/.env.local
#   2) Replaces NEXTAUTH_URL=http://localhost:* with the supplied dev_port
#   3) Runs `npx prisma db push --schema <worktree_path>/prisma/schema.prisma --skip-generate`
#      using DATABASE_URL=file:./dev.db (worktree-relative) so each worktree gets its own SQLite DB.
#   4) Prints a completion banner with paths/ports.
#
# Notes:
#   - Re-running on an already-bootstrapped worktree is safe (overwrites .env.local, db push is idempotent).
#   - New deps are NOT installed here; assume the worktree was created from main with node_modules linked or
#     a separate `npm install` already run.
#   - Discovery context: TM-42/43/45 retros surfaced repeated manual env+db setup pain.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "[setup-worktree] usage: bash scripts/setup-worktree.sh <worktree_path> <dev_port>" >&2
  exit 64
fi

WORKTREE_PATH="$1"
DEV_PORT="$2"

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
echo "[setup-worktree] dev port:    $DEV_PORT"

# 1) Copy .env.local
cp "$MAIN_REPO/.env.local" "$WORKTREE_PATH/.env.local"

# 2) Substitute NEXTAUTH_URL port. Use a temp file for portable in-place edit.
TMP_ENV="$WORKTREE_PATH/.env.local.tmp"
awk -v port="$DEV_PORT" '
  BEGIN { replaced = 0 }
  /^NEXTAUTH_URL=/ {
    print "NEXTAUTH_URL=http://localhost:" port
    replaced = 1
    next
  }
  { print }
  END {
    if (!replaced) {
      print "NEXTAUTH_URL=http://localhost:" port
    }
  }
' "$WORKTREE_PATH/.env.local" > "$TMP_ENV"
mv "$TMP_ENV" "$WORKTREE_PATH/.env.local"

echo "[setup-worktree] .env.local copied + NEXTAUTH_URL pinned to :$DEV_PORT"

# 3) Prisma db push (worktree-local SQLite at <worktree>/prisma/dev.db via DATABASE_URL=file:./dev.db).
#    The schema file in the worktree controls the migration; --skip-generate avoids regenerating client
#    (the worktree shares node_modules in most setups).
SCHEMA_PATH="$WORKTREE_PATH/prisma/schema.prisma"
if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "[setup-worktree] prisma/schema.prisma not found at $SCHEMA_PATH — skipping db push" >&2
else
  pushd "$WORKTREE_PATH" >/dev/null
  # Use the .env.local we just wrote so DATABASE_URL is picked up.
  DATABASE_URL="file:./dev.db" npx --yes prisma db push --schema "$SCHEMA_PATH" --skip-generate
  popd >/dev/null
  echo "[setup-worktree] prisma db push OK ($WORKTREE_PATH/prisma/dev.db)"
fi

echo ""
echo "[setup-worktree] DONE"
echo "  worktree:     $WORKTREE_PATH"
echo "  NEXTAUTH_URL: http://localhost:$DEV_PORT"
echo "  next steps:   cd $WORKTREE_PATH && PORT=$DEV_PORT npm run dev"
