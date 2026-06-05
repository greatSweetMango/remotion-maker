#!/usr/bin/env bash
# Integration test for scripts/lib/task-queue.sh (TM-209).
#
# - Builds a throwaway repo-shaped sandbox with .agent-state/ and a tagged
#   .taskmaster/tasks/tasks.json.
# - Spawns N parallel append-task writers + interleaved set-status writers.
# - Asserts: final JSON valid, ZERO lost appends, every id is a STRING.
# - Verifies the mutex serializes against a concurrent raw read-modify-write
#   (the exact int/str race TM-209 fixes).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="${HERE}/lib/task-queue.sh"

if [[ ! -f "${LIB}" ]]; then
  echo "[test] FAIL: missing ${LIB}"
  exit 1
fi

sandbox="$(mktemp -d -t task-queue-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT
mkdir -p "${sandbox}/.agent-state" "${sandbox}/.taskmaster/tasks"
echo '{"master":{"tasks":[],"metadata":{}}}' > "${sandbox}/.taskmaster/tasks/tasks.json"
echo '{"currentTag":"master"}' > "${sandbox}/.taskmaster/state.json"
cd "${sandbox}"

N=20
echo "[test] launching ${N} parallel append-task writers"

pids=()
for i in $(seq 1 ${N}); do
  (
    bash "${LIB}" append-task \
      "{\"id\":${i},\"title\":\"T-${i}\",\"status\":\"pending\"}"
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
(( fail )) && { echo "[test] FAIL: a writer errored"; exit 1; }

# Valid JSON?
if ! jq -e . .taskmaster/tasks/tasks.json >/dev/null; then
  echo "[test] FAIL: final JSON invalid"; cat .taskmaster/tasks/tasks.json; exit 1
fi

# No lost appends?
count="$(jq '.master.tasks | length' .taskmaster/tasks/tasks.json)"
if [[ "${count}" -ne ${N} ]]; then
  echo "[test] FAIL: expected ${N} tasks, got ${count} (lost append → race)"
  jq '.master.tasks | map(.id)' .taskmaster/tasks/tasks.json
  exit 1
fi
echo "[test] OK: ${N} appends survived concurrent writes"

# All ids unique 1..N?
uniq="$(jq '[.master.tasks[].id|tonumber] | unique | length' .taskmaster/tasks/tasks.json)"
if [[ "${uniq}" -ne ${N} ]]; then
  echo "[test] FAIL: ids not unique (${uniq} unique of ${N})"; exit 1
fi

# Every id a STRING?
types="$(jq -c '[.master.tasks[].id|type]|unique' .taskmaster/tasks/tasks.json)"
if [[ "${types}" != '["string"]' ]]; then
  echo "[test] FAIL: id types not all string: ${types}"; exit 1
fi
echo "[test] OK: all ids unique + string-typed"

# Concurrent set-status under contention.
for i in $(seq 1 ${N}); do
  if (( i % 2 == 0 )); then
    bash "${LIB}" set-status "${i}" "done" &
  else
    bash "${LIB}" set-status "TM-${i}" "in-progress" &   # TM- prefix accepted
  fi
done
wait

done_n="$(jq '[.master.tasks[]|select(.status=="done")]|length' .taskmaster/tasks/tasks.json)"
inprog_n="$(jq '[.master.tasks[]|select(.status=="in-progress")]|length' .taskmaster/tasks/tasks.json)"
exp=$(( N / 2 ))
if [[ "${done_n}" -ne ${exp} || "${inprog_n}" -ne ${exp} ]]; then
  echo "[test] FAIL: status counts done=${done_n} inprog=${inprog_n} (expected ${exp} each)"
  exit 1
fi
# count unchanged (no task lost/duplicated during status churn)
count2="$(jq '.master.tasks | length' .taskmaster/tasks/tasks.json)"
[[ "${count2}" -eq ${N} ]] || { echo "[test] FAIL: count drifted to ${count2}"; exit 1; }
echo "[test] OK: set-status concurrency clean (TM- prefix + bare id both matched)"

# Mutex also serializes a raw read-modify-write done via with-lock.
# Append 10 more ids 100..109 each via a manual jq under with-lock, in parallel
# with 10 more append-task calls 200..209. Expect 20 net new tasks, no loss.
rmw_pids=()
for i in $(seq 100 109); do
  (
    bash "${LIB}" with-lock bash -c '
      f=".taskmaster/tasks/tasks.json"
      jq --arg id "'"${i}"'" \
         ".master.tasks += [{id:\$id,title:(\"R-\"+\$id),status:\"pending\"}]" \
         "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    '
  ) &
  rmw_pids+=($!)
  bash "${LIB}" append-task "{\"id\":$((i+100)),\"title\":\"P\",\"status\":\"pending\"}" &
  rmw_pids+=($!)
done
for pid in "${rmw_pids[@]}"; do wait "${pid}" || { echo "[test] FAIL: rmw writer errored"; exit 1; }; done

final="$(jq '.master.tasks | length' .taskmaster/tasks/tasks.json)"
if [[ "${final}" -ne $(( N + 20 )) ]]; then
  echo "[test] FAIL: expected $(( N + 20 )) after mixed rmw, got ${final} (lost update)"
  exit 1
fi
if ! jq -e . .taskmaster/tasks/tasks.json >/dev/null; then
  echo "[test] FAIL: JSON invalid after mixed rmw"; exit 1
fi
echo "[test] OK: with-lock serializes raw read-modify-write against append-task"

echo "[test] PASS"
