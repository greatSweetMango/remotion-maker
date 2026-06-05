#!/usr/bin/env bash
# scripts/orchestrator/promote-spawned.sh
#
# TM-97 — Promote TeamLead spawned_tasks[] entries into the canonical
# task-master DB on `main`, allocating real IDs.
#
# TeamLead (running inside a worktree) cannot safely call `task-master
# add-task` because its `.taskmaster/tasks/tasks.json` is a stale copy of
# main (see check-cwd.sh). Instead it returns spawned tasks as JSON in its
# summary, and the Orchestrator (running in the canonical main repo) calls
# this script after the PR merges.
#
# Input: a JSON file (or '-' for stdin) shaped like the `spawned_tasks`
# array in the TeamLead summary:
#
#   [
#     {
#       "placeholder_id": "TM-97-spawn-1",   // optional, for back-reference
#       "title": "AI-BUG-foo-bar",           // required
#       "description": "...",                // required
#       "details": "...",                    // optional
#       "priority": "high|medium|low",       // optional, default medium
#       "dependencies": ["97"],              // optional, canonical IDs
#       "triggers_requalify": ["TM-X"]       // optional, propagates as metadata
#     }
#   ]
#
# Output (stdout): JSON array mapping placeholder_id → canonical ID:
#
#   [
#     {"placeholder_id": "TM-97-spawn-1", "canonical_id": "112", "title": "..."}
#   ]
#
# Exit codes:
#   0 — all tasks added (or input was empty array)
#   1 — task-master add-task failure for at least one entry
#   2 — usage / parse error
#   20 — refusing to run from a worktree (delegates to check-cwd.sh)
#
# Safety:
#   - Must run from the canonical main repo. Calls check-cwd.sh first.
#   - Acquires an flock on .agent-state/task-master.lock so concurrent
#     orchestrator iters don't race on the tasks.json append.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
CHECK_CWD="${HERE}/orchestrator/check-cwd.sh"
LOCK_DIR="${ROOT}/.agent-state"

# TM-209: serialize tasks.json mutations through the single shared writer mutex
# (.agent-state/.tasks.lock) instead of a private task-master.lock. This makes
# `task-master add-task` here mutually exclusive with every other tasks.json
# writer that goes through scripts/lib/task-queue.sh, and adds the mkdir mutex
# fallback so mac (no flock) is also protected — previously this script ran
# add-task with NO lock on mac, the exact race TM-209 closes.
# shellcheck source=../lib/task-queue.sh
source "${HERE}/lib/task-queue.sh"

if [[ ! -x "${CHECK_CWD}" ]] && [[ ! -f "${CHECK_CWD}" ]]; then
  echo "promote-spawned.sh: missing ${CHECK_CWD}" >&2
  exit 2
fi

# Guard: refuse to run inside a worktree.
# PROMOTE_SKIP_CWD_CHECK=1 bypasses (test harness only).
if [[ -z "${PROMOTE_SKIP_CWD_CHECK:-}" ]]; then
  set +e
  bash "${CHECK_CWD}" "${ROOT}" >/dev/null 2>&1
  rc=$?
  set -e
  if [[ "${rc}" -eq 20 ]]; then
    echo "promote-spawned.sh: refusing — running inside a worktree (TM-97)" >&2
    exit 20
  fi
  if [[ "${rc}" -ne 0 ]]; then
    echo "promote-spawned.sh: check-cwd.sh failed (rc=${rc})" >&2
    exit 1
  fi
fi

input="${1:-}"
if [[ -z "${input}" ]]; then
  echo "usage: $0 <spawned-tasks.json | ->" >&2
  exit 2
fi

if [[ "${input}" == "-" ]]; then
  json="$(cat)"
else
  if [[ ! -f "${input}" ]]; then
    echo "promote-spawned.sh: file not found: ${input}" >&2
    exit 2
  fi
  json="$(cat "${input}")"
fi

# Validate it's a JSON array.
if ! echo "${json}" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "promote-spawned.sh: input must be a JSON array" >&2
  exit 2
fi

count="$(echo "${json}" | jq 'length')"
if [[ "${count}" -eq 0 ]]; then
  echo "[]"
  exit 0
fi

mkdir -p "${LOCK_DIR}"

# Determine task-master command path.
TM_CMD="${TASK_MASTER_CMD:-task-master}"
if ! command -v "${TM_CMD}" >/dev/null 2>&1; then
  echo "promote-spawned.sh: ${TM_CMD} not in PATH" >&2
  exit 1
fi

# All add-task work runs inside this function, executed under the shared
# tasks.json mutex via task_queue_with_lock (TM-209). Prints the result map
# to stdout on success; exits non-zero on failure.
__promote_run_all() {
  local results='[]'
  local i
  for i in $(seq 0 $((count - 1))); do
  entry="$(echo "${json}" | jq -c ".[${i}]")"
  title="$(echo "${entry}" | jq -r '.title // empty')"
  desc="$(echo "${entry}"  | jq -r '.description // empty')"
  details="$(echo "${entry}" | jq -r '.details // empty')"
  prio="$(echo "${entry}"  | jq -r '.priority // "medium"')"
  deps="$(echo "${entry}"  | jq -r '.dependencies // [] | join(",")')"
  placeholder="$(echo "${entry}" | jq -r '.placeholder_id // empty')"
  triggers="$(echo "${entry}" | jq -r '.triggers_requalify // [] | join(",")')"

  if [[ -z "${title}" || -z "${desc}" ]]; then
    echo "promote-spawned.sh: entry ${i} missing title or description" >&2
    exit 2
  fi

  # Build add-task args.
  add_args=(add-task -t "${title}" -d "${desc}" --priority "${prio}")
  if [[ -n "${details}" ]]; then add_args+=(--details "${details}"); fi
  if [[ -n "${deps}" ]];    then add_args+=(--dependencies "${deps}"); fi

  if [[ -n "${PROMOTE_DRY_RUN:-}" ]]; then
    new_id="DRY-${i}"
    echo "promote-spawned.sh: [dry-run] would add: ${title}" >&2
  else
    # task-master add-task prints created task id. Capture stdout.
    out="$("${TM_CMD}" "${add_args[@]}" 2>&1)" || {
      echo "promote-spawned.sh: task-master add-task failed for '${title}'" >&2
      echo "${out}" >&2
      exit 1
    }
    # Extract newly-allocated ID. task-master typically reports "Task #N added"
    # or similar; fall back to scanning tasks.json for the title.
    new_id="$(echo "${out}" | grep -oE 'Task #[0-9]+|id[: =]+[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"
    if [[ -z "${new_id}" ]]; then
      # Fallback: read tasks.json and find max id matching title.
      tasks_file="${ROOT}/.taskmaster/tasks/tasks.json"
      if [[ -f "${tasks_file}" ]]; then
        # Tagged-format aware: tasks live under a tag key (e.g. .master.tasks),
        # falling back to legacy untagged .tasks. ids may be int or str.
        new_id="$(jq -r --arg t "${title}" \
          '((.. | objects | select(has("tasks")) | .tasks) // []) | .[] | select(.title == $t) | .id' \
          "${tasks_file}" 2>/dev/null | sort -n | tail -1)"
      fi
    fi
    if [[ -z "${new_id}" ]]; then
      echo "promote-spawned.sh: could not determine new id for '${title}'" >&2
      exit 1
    fi

    # If triggers_requalify present, append as metadata.
    if [[ -n "${triggers}" ]]; then
      "${TM_CMD}" update-task --id="${new_id}" --append \
        --prompt "metadata: {\"triggers_requalify\": [\"${triggers//,/\",\"}\"]}" \
        >/dev/null 2>&1 || true
    fi
  fi

  results="$(echo "${results}" | jq --arg p "${placeholder}" --arg c "${new_id}" --arg t "${title}" \
    '. + [{placeholder_id: $p, canonical_id: $c, title: $t}]')"
  done

  echo "${results}"
}

# Run the whole add-task batch under the single shared tasks.json mutex.
task_queue_with_lock __promote_run_all
exit 0
