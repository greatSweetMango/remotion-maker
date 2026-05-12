#!/usr/bin/env bash
# Unit test for scripts/pre-pr.sh — mocks gh via PRE_PR_GH_CMD.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="${HERE}/pre-pr.sh"

# Need a real git branch context for the script's default arg resolution
sandbox="$(mktemp -d -t pre-pr-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT
cd "${sandbox}"
git init -q
git checkout -q -b feat/tm-foo
git commit --allow-empty -q -m "init"

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

# Case 1: no PR exists — exit 0
PRE_PR_GH_CMD='echo "[]"' \
  expect_exit "no existing PR" 0 \
  bash "${HOOK}" feat/tm-foo

# Case 2: open PR exists — exit 10
PRE_PR_GH_CMD='echo "[{\"number\":126,\"url\":\"https://x/126\",\"state\":\"OPEN\",\"title\":\"t\",\"mergedAt\":null}]"' \
  expect_exit "open PR blocks" 10 \
  bash "${HOOK}" feat/tm-foo

# Case 3: merged PR — exit 11
PRE_PR_GH_CMD='echo "[{\"number\":132,\"url\":\"https://x/132\",\"state\":\"MERGED\",\"title\":\"t\",\"mergedAt\":\"2026-05-12\"}]"' \
  expect_exit "merged PR blocks" 11 \
  bash "${HOOK}" feat/tm-foo

# Case 4: closed PR — exit 12
PRE_PR_GH_CMD='echo "[{\"number\":99,\"url\":\"https://x/99\",\"state\":\"CLOSED\",\"title\":\"t\",\"mergedAt\":null}]"' \
  expect_exit "closed PR warns" 12 \
  bash "${HOOK}" feat/tm-foo

# Case 5: OPEN + MERGED both exist — OPEN should win (re-merge scenario)
PRE_PR_GH_CMD='echo "[{\"number\":50,\"url\":\"https://x/50\",\"state\":\"MERGED\",\"title\":\"old\",\"mergedAt\":\"2026-04\"},{\"number\":133,\"url\":\"https://x/133\",\"state\":\"OPEN\",\"title\":\"new\",\"mergedAt\":null}]"' \
  expect_exit "open beats merged" 10 \
  bash "${HOOK}" feat/tm-foo

# Case 6: machine-readable output present on duplicate
out="$(PRE_PR_GH_CMD='echo "[{\"number\":133,\"url\":\"https://x/133\",\"state\":\"OPEN\",\"title\":\"t\",\"mergedAt\":null}]"' \
       bash "${HOOK}" feat/tm-foo || true)"
if ! grep -q 'PR_NUMBER=133' <<<"${out}" || ! grep -q 'STATE=OPEN' <<<"${out}"; then
  echo "[test] FAIL machine-readable output missing"
  echo "${out}"
  exit 1
fi
echo "[test] OK machine-readable output present"

echo "[test] PASS"
