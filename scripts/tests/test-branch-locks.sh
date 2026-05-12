#!/usr/bin/env bash
# Integration test for scripts/lib/branch-locks.sh.
#
# - Creates a throwaway repo-shaped sandbox in $TMPDIR with its own
#   .agent-state/ directory.
# - Spawns N parallel writers, each appending a unique TM-i entry.
# - Asserts: final JSON is valid, contains all N entries, no writes lost.
# - Also exercises set-status + remove-entry under contention.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="${HERE}/lib/branch-locks.sh"

sandbox="$(mktemp -d -t branch-locks-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT
mkdir -p "${sandbox}/.agent-state"
echo "{}" > "${sandbox}/.agent-state/branch-locks.json"
cd "${sandbox}"

N=20
echo "[test] launching ${N} parallel writers in ${sandbox}"

pids=()
for i in $(seq 1 ${N}); do
  (
    bash "${LIB}" set-entry "TM-${i}" \
      "{\"branch\":\"feat/tm-${i}\",\"status\":\"in_progress\",\"worktree\":\"worktrees/TM-${i}\"}"
  ) &
  pids+=($!)
done

fail=0
for pid in "${pids[@]}"; do
  if ! wait "${pid}"; then
    echo "[test] writer pid=${pid} FAILED" >&2
    fail=1
  fi
done

if (( fail )); then
  echo "[test] one or more writers failed"
  exit 1
fi

# Validate JSON
if ! jq -e . .agent-state/branch-locks.json >/dev/null; then
  echo "[test] FAIL: final JSON is invalid"
  cat .agent-state/branch-locks.json
  exit 1
fi

# Count entries
count="$(jq 'length' .agent-state/branch-locks.json)"
if [[ "${count}" -ne ${N} ]]; then
  echo "[test] FAIL: expected ${N} entries, got ${count}"
  jq . .agent-state/branch-locks.json
  exit 1
fi
echo "[test] OK: ${N} entries survived concurrent writes"

# Concurrent status updates + removes
for i in $(seq 1 ${N}); do
  if (( i % 2 == 0 )); then
    bash "${LIB}" set-status "TM-${i}" "blocked" &
  else
    bash "${LIB}" remove-entry "TM-${i}" &
  fi
done
wait

remaining="$(jq 'length' .agent-state/branch-locks.json)"
expected=$(( N / 2 ))
if [[ "${remaining}" -ne ${expected} ]]; then
  echo "[test] FAIL: expected ${expected} after removes, got ${remaining}"
  jq . .agent-state/branch-locks.json
  exit 1
fi

blocked="$(jq '[.[] | select(.status == "blocked")] | length' .agent-state/branch-locks.json)"
if [[ "${blocked}" -ne ${expected} ]]; then
  echo "[test] FAIL: expected ${expected} blocked, got ${blocked}"
  exit 1
fi

echo "[test] OK: set-status / remove-entry concurrency clean"
echo "[test] PASS"
