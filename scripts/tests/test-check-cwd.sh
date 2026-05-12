#!/usr/bin/env bash
# Unit tests for scripts/orchestrator/check-cwd.sh (TM-97).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="${HERE}/orchestrator/check-cwd.sh"

if [[ ! -f "${HOOK}" ]]; then
  echo "[test] FAIL: missing ${HOOK}"
  exit 1
fi

sandbox="$(mktemp -d -t check-cwd-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT

expect_exit() {
  local desc="$1" want="$2"; shift 2
  set +e
  ( "$@" ) >/dev/null 2>&1
  local got=$?
  set -e
  if [[ "${got}" -ne "${want}" ]]; then
    echo "[test] FAIL ${desc}: expected exit ${want}, got ${got}"
    exit 1
  fi
  echo "[test] OK ${desc} → exit ${want}"
}

# Case 1: canonical main repo path (no /worktrees/ segment, not a linked worktree)
main_repo="${sandbox}/main-repo"
mkdir -p "${main_repo}"
( cd "${main_repo}" && git init -q && git commit --allow-empty -q -m init )
expect_exit "canonical main repo allowed" 0 bash "${HOOK}" "${main_repo}"

# Case 2: path containing /worktrees/ segment
wt_path="${sandbox}/main-repo/worktrees/TM-99-foo"
mkdir -p "${wt_path}"
expect_exit "worktrees/* path blocked" 20 bash "${HOOK}" "${wt_path}"

# Case 3: real git worktree (linked, not under /worktrees/ by name)
adhoc="${sandbox}/adhoc-linked"
( cd "${main_repo}" && git worktree add -q -b tm-97-test "${adhoc}" 2>/dev/null ) || true
if [[ -d "${adhoc}" ]]; then
  expect_exit "linked git worktree blocked (git-dir != git-common-dir)" 20 bash "${HOOK}" "${adhoc}"
else
  echo "[test] SKIP linked-worktree case (git worktree add unavailable)"
fi

# Case 4: missing directory
expect_exit "missing dir → 1" 1 bash "${HOOK}" "${sandbox}/nope"

# Case 5: stdout machine-readable on block
out="$(bash "${HOOK}" "${wt_path}" 2>/dev/null || true)"
if ! grep -q "^WORKTREE=1" <<<"${out}"; then
  echo "[test] FAIL: blocked output missing WORKTREE=1 line"
  exit 1
fi
echo "[test] OK machine-readable output on block"

echo "[test] all check-cwd.sh tests passed"
