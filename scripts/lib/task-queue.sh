#!/usr/bin/env bash
# scripts/lib/task-queue.sh
#
# TM-209 — Single-writer mutex for .taskmaster/tasks/tasks.json.
#
# Background: this repo's tasks.json got "corrupted" (a false alarm) when a
# raw `python` writer and a `task-master` MCP write interleaved with no
# serialization. The interleave produced an int/str `id` type confusion and a
# lost-update race. The fix is to funnel every read-modify-write of tasks.json
# through one serialized writer, exactly like branch-locks.sh does for
# .agent-state/branch-locks.json.
#
# This file is a thin wrapper that REUSES the same mutex strategy as
# scripts/lib/branch-locks.sh:
#   1. flock(2) (Linux / CI / homebrew flock on mac) → kernel advisory lock
#      against .agent-state/.tasks.lock.
#   2. mkdir() shell mutex fallback (atomic on APFS/HFS+) when flock is absent.
#
# It uses a DISTINCT lock anchor (.agent-state/.tasks.lock + .tasks.mutex.d) so
# it never contends with the branch-locks mutex — both can be held at once
# without deadlock, and existing branch-locks behaviour is untouched (additive).
#
# Tagged-format aware: task-master stores tasks under a tag key, e.g.
#   { "master": { "tasks": [ {"id": ...}, ... ], "metadata": {...} } }
# We resolve the active tag from .taskmaster/state.json (`currentTag`), falling
# back to "master", then to the sole top-level key, then to a legacy untagged
# `.tasks` array.
#
# ★ id normalization: every id this library writes is coerced to a STRING.
#   Reads also expose ids as strings. This kills the int/str confusion at the
#   single write chokepoint.
#
# Usage (source):
#   source scripts/lib/task-queue.sh
#   task_queue_set_status TM-209 done       # or bare "209"
#   task_queue_set_status 209 in-progress
#   task_queue_append_task '{"id":"210","title":"X","status":"pending"}'
#   task_queue_with_lock jq '...' "$TASK_QUEUE_FILE"   # arbitrary cmd under lock
#
# Usage (CLI — no sourcing needed):
#   bash scripts/lib/task-queue.sh set-status 209 done
#   bash scripts/lib/task-queue.sh append-task '{"id":"210",...}'
#   bash scripts/lib/task-queue.sh read
#   bash scripts/lib/task-queue.sh with-lock <cmd...>
#
# Reads of a committed tasks.json are atomic (single open of a file that is
# only ever replaced via atomic rename), so task_queue_read does not take the
# lock. All mutations do.

set -euo pipefail

# --- repo root resolution (same walk-up strategy as branch-locks.sh) ------
__task_queue_repo_root() {
  local d="${PWD}"
  while [[ "${d}" != "/" ]]; do
    if [[ -d "${d}/.agent-state" ]]; then
      echo "${d}"
      return 0
    fi
    d="$(dirname "${d}")"
  done
  echo "task-queue.sh: cannot locate .agent-state/ from ${PWD}" >&2
  return 1
}

TASK_QUEUE_ROOT="${TASK_QUEUE_ROOT:-$(__task_queue_repo_root)}"
TASK_QUEUE_FILE="${TASK_QUEUE_FILE:-${TASK_QUEUE_ROOT}/.taskmaster/tasks/tasks.json}"
TASK_QUEUE_STATE_FILE="${TASK_QUEUE_STATE_FILE:-${TASK_QUEUE_ROOT}/.taskmaster/state.json}"
TASK_QUEUE_LOCKFILE="${TASK_QUEUE_ROOT}/.agent-state/.tasks.lock"
TASK_QUEUE_MUTEX_DIR="${TASK_QUEUE_ROOT}/.agent-state/.tasks.mutex.d"
TASK_QUEUE_TIMEOUT_SEC="${TASK_QUEUE_TIMEOUT_SEC:-30}"

__task_queue_ensure_files() {
  mkdir -p "${TASK_QUEUE_ROOT}/.agent-state"
  [[ -f "${TASK_QUEUE_LOCKFILE}" ]] || : > "${TASK_QUEUE_LOCKFILE}"
  if [[ ! -f "${TASK_QUEUE_FILE}" ]]; then
    mkdir -p "$(dirname "${TASK_QUEUE_FILE}")"
    echo '{"master":{"tasks":[],"metadata":{}}}' > "${TASK_QUEUE_FILE}"
  fi
}

# Resolve the active tag key inside tasks.json.
# Priority: state.json currentTag → "master" if present → sole top-level key.
__task_queue_active_tag() {
  local tag=""
  if [[ -f "${TASK_QUEUE_STATE_FILE}" ]]; then
    tag="$(jq -r '.currentTag // empty' "${TASK_QUEUE_STATE_FILE}" 2>/dev/null || true)"
  fi
  if [[ -n "${tag}" ]] && jq -e --arg t "${tag}" 'has($t) and (.[$t] | has("tasks"))' \
        "${TASK_QUEUE_FILE}" >/dev/null 2>&1; then
    echo "${tag}"; return 0
  fi
  if jq -e '.master | has("tasks")' "${TASK_QUEUE_FILE}" >/dev/null 2>&1; then
    echo "master"; return 0
  fi
  # Sole tagged key with a .tasks array.
  local sole
  sole="$(jq -r 'to_entries | map(select(.value | type=="object" and has("tasks"))) | (.[0].key // empty)' \
        "${TASK_QUEUE_FILE}" 2>/dev/null || true)"
  if [[ -n "${sole}" ]]; then echo "${sole}"; return 0; fi
  # Legacy untagged shape: top-level .tasks. Signal with empty tag.
  echo ""
  return 0
}

# --- mutex implementations (mirrors branch-locks.sh) ----------------------

# Acquire an exclusive flock on fd 8 (already open by caller), then run the
# command DIRECTLY in this shell so bash functions remain in scope. (Using
# `flock -c "<string>"` would re-exec under sh and lose function definitions.)
__task_queue_with_flock() {
  if ! flock --exclusive --timeout "${TASK_QUEUE_TIMEOUT_SEC}" 8; then
    echo "task-queue: could not acquire flock within ${TASK_QUEUE_TIMEOUT_SEC}s" >&2
    return 75
  fi
  "$@"
  # fd 8 is closed by the caller (task_queue_with_lock), releasing the lock.
}

__task_queue_with_shellmutex() {
  local waited=0
  local sleep_step=1
  while ! mkdir "${TASK_QUEUE_MUTEX_DIR}" 2>/dev/null; do
    if [[ -d "${TASK_QUEUE_MUTEX_DIR}" ]]; then
      local mtime now
      mtime="$(stat -f %m "${TASK_QUEUE_MUTEX_DIR}" 2>/dev/null \
                || stat -c %Y "${TASK_QUEUE_MUTEX_DIR}" 2>/dev/null \
                || echo "")"
      now="$(date +%s)"
      if [[ -n "${mtime}" ]] && (( mtime > 0 )) \
         && (( now - mtime > 2 * TASK_QUEUE_TIMEOUT_SEC )); then
        echo "task-queue: stale mutex (age=$((now-mtime))s) — reaping" >&2
        rm -rf "${TASK_QUEUE_MUTEX_DIR}"
        continue
      fi
    fi
    if (( waited >= TASK_QUEUE_TIMEOUT_SEC )); then
      echo "task-queue: shell mutex timeout after ${waited}s" >&2
      return 75
    fi
    sleep "${sleep_step}"
    waited=$(( waited + sleep_step ))
  done
  trap 'rm -rf "${TASK_QUEUE_MUTEX_DIR}"' EXIT INT TERM
  "$@"
  local rc=$?
  rm -rf "${TASK_QUEUE_MUTEX_DIR}"
  trap - EXIT INT TERM
  return ${rc}
}

# Public: run <cmd...> while holding the tasks.json mutex.
task_queue_with_lock() {
  __task_queue_ensure_files
  if command -v flock >/dev/null 2>&1; then
    exec 8>"${TASK_QUEUE_LOCKFILE}"
    __task_queue_with_flock "$@"
    local rc=$?
    exec 8>&-
    return ${rc}
  else
    __task_queue_with_shellmutex "$@"
  fi
}

# --- read / atomic write --------------------------------------------------

task_queue_read() {
  __task_queue_ensure_files
  cat "${TASK_QUEUE_FILE}"
}

# Replace tasks.json atomically with stdin contents. Validates JSON first.
__task_queue_atomic_write() {
  local tmp
  tmp="$(mktemp "${TASK_QUEUE_FILE}.XXXXXX")"
  cat > "${tmp}"
  if ! jq -e . >/dev/null < "${tmp}"; then
    echo "task-queue: refusing to write invalid JSON" >&2
    rm -f "${tmp}"
    return 1
  fi
  mv "${tmp}" "${TASK_QUEUE_FILE}"
}

# jq filter applied to the active tag's .tasks array. $1 = jq program operating
# on the tasks array (as `.`); remaining args forwarded to jq (e.g. --arg ...).
# Always re-stringifies every id afterwards.
__task_queue_mutate_tasks() {
  local prog="$1"; shift
  local tag
  tag="$(__task_queue_active_tag)"
  if [[ -n "${tag}" ]]; then
    jq --arg __tag "${tag}" \
       "(.[\$__tag].tasks) |= ((${prog}) | map(.id |= tostring))" \
       "$@" "${TASK_QUEUE_FILE}" | __task_queue_atomic_write
  else
    jq "(.tasks) |= ((${prog}) | map(.id |= tostring))" \
       "$@" "${TASK_QUEUE_FILE}" | __task_queue_atomic_write
  fi
}

# --- command bodies (run only under the lock) -----------------------------

# Set the status of the task whose id matches (string-compared). Accepts bare
# numeric id or TM-prefixed; both are normalized to the bare-string form used
# in tasks.json (task-master stores ids as bare numbers/strings, not TM-N).
__task_queue_normalize_id() {
  local raw="$1"
  # Strip a leading TM- (case-insensitive) so "TM-209" and "209" both match.
  raw="${raw#TM-}"; raw="${raw#tm-}"
  printf '%s' "${raw}"
}

__task_queue_set_status_impl() {
  local id status
  id="$(__task_queue_normalize_id "$1")"
  status="$2"
  __task_queue_mutate_tasks \
    'map(if (.id|tostring) == $__id then .status = $__st else . end)' \
    --arg __id "${id}" --arg __st "${status}"
}

__task_queue_append_task_impl() {
  local task_json="$1"
  # Coerce the incoming task's id to string and guard against duplicates.
  __task_queue_mutate_tasks \
    'if any(.[]; (.id|tostring) == ($__new.id|tostring))
       then error("task-queue: duplicate id \($__new.id)")
       else . + [$__new] end' \
    --argjson __new "${task_json}"
}

# --- public helpers (wrap each mutation in the lock) ----------------------

task_queue_set_status() {
  local id="$1" status="$2"
  task_queue_with_lock __task_queue_set_status_impl "${id}" "${status}"
}

task_queue_append_task() {
  local task_json="$1"
  task_queue_with_lock __task_queue_append_task_impl "${task_json}"
}

# CLI dispatcher.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-}"; shift || true
  case "${cmd}" in
    read)        task_queue_read ;;
    active-tag)  __task_queue_ensure_files; __task_queue_active_tag ;;
    set-status)  task_queue_set_status "$@" ;;
    append-task) task_queue_append_task "$@" ;;
    with-lock)   task_queue_with_lock "$@" ;;
    *)
      cat >&2 <<EOF
usage: task-queue.sh <subcmd> [args]
  read
  active-tag
  set-status <id> <status>      # id: "209" or "TM-209"
  append-task <task_json>       # id coerced to string; duplicate id rejected
  with-lock <cmd> [args...]     # run cmd while holding .agent-state/.tasks.lock
EOF
      exit 2
      ;;
  esac
fi
