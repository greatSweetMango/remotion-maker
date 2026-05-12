#!/usr/bin/env bash
# scripts/lib/branch-locks.sh
#
# Mutex-protected read/modify/write for .agent-state/branch-locks.json.
# Prevents the PR-duplicate race observed in TM-55 / TM-85, where two
# concurrent Orchestrator/TeamLead processes wrote the same JSON file with
# no serialization and a stale snapshot of `active_locks` was used to
# decide whether a PR for the same branch already existed.
#
# Strategy:
#   1. If `flock(2)` is available (Linux/CI, or homebrew flock on mac),
#      use it for a real kernel-level advisory exclusive lock against
#      .agent-state/branch-locks.lock.
#   2. Otherwise fall back to a shell mutex implemented with `mkdir`,
#      which is atomic on POSIX filesystems (HFS+, APFS included).
#
# All write paths go through `branch_locks_with_mutex <cmd...>`.
#
# Usage:
#   source scripts/lib/branch-locks.sh
#   branch_locks_with_mutex jq '. + {"TM-X": {...}}' .agent-state/branch-locks.json \
#       > .agent-state/branch-locks.json.tmp \
#     && mv .agent-state/branch-locks.json.tmp .agent-state/branch-locks.json
#
# Convenience helpers (preferred — they handle tmp + atomic rename):
#   branch_locks_set_entry TM-X '{"branch":"feat/...","status":"in_progress","worktree":"worktrees/TM-X"}'
#   branch_locks_remove_entry TM-X
#   branch_locks_set_status TM-X blocked
#
# Reads do not require the mutex (jq is a single read syscall on a
# committed file — atomic rename guarantees we never see a partial
# write), but `branch_locks_read` is provided for symmetry.

set -euo pipefail

# --- repo root resolution ------------------------------------------------
__branch_locks_repo_root() {
  # Walk up from caller's PWD until we find .agent-state/.
  local d="${PWD}"
  while [[ "${d}" != "/" ]]; do
    if [[ -d "${d}/.agent-state" ]]; then
      echo "${d}"
      return 0
    fi
    d="$(dirname "${d}")"
  done
  echo "branch-locks.sh: cannot locate .agent-state/ from ${PWD}" >&2
  return 1
}

BRANCH_LOCKS_ROOT="$(__branch_locks_repo_root)"
BRANCH_LOCKS_FILE="${BRANCH_LOCKS_ROOT}/.agent-state/branch-locks.json"
BRANCH_LOCKS_LOCKFILE="${BRANCH_LOCKS_ROOT}/.agent-state/branch-locks.lock"
BRANCH_LOCKS_MUTEX_DIR="${BRANCH_LOCKS_ROOT}/.agent-state/branch-locks.mutex.d"
BRANCH_LOCKS_TIMEOUT_SEC="${BRANCH_LOCKS_TIMEOUT_SEC:-30}"

# Ensure the lock anchor + base file exist (idempotent).
__branch_locks_ensure_files() {
  mkdir -p "${BRANCH_LOCKS_ROOT}/.agent-state"
  [[ -f "${BRANCH_LOCKS_FILE}" ]] || echo "{}" > "${BRANCH_LOCKS_FILE}"
  [[ -f "${BRANCH_LOCKS_LOCKFILE}" ]] || : > "${BRANCH_LOCKS_LOCKFILE}"
}

# --- mutex implementations ----------------------------------------------

# flock(2) path. Returns 0 on success, non-zero on timeout / lock failure.
__branch_locks_with_flock() {
  # shellcheck disable=SC2068
  flock --exclusive --timeout "${BRANCH_LOCKS_TIMEOUT_SEC}" \
        --conflict-exit-code 75 \
        9 -c "$(printf '%q ' "$@")"
}

# Shell fallback. `mkdir DIR` is atomic — exactly one process succeeds.
# Spin with bounded retries until BRANCH_LOCKS_TIMEOUT_SEC elapses.
__branch_locks_with_shellmutex() {
  local waited=0
  local sleep_step=1
  while ! mkdir "${BRANCH_LOCKS_MUTEX_DIR}" 2>/dev/null; do
    # Stale lock detection: if mtime > 2x timeout, assume crashed holder.
    # Guard: only reap when we can actually read the mtime AND it's old.
    # A failed stat (dir vanished mid-check) means another holder is
    # already finishing — back off, don't reap.
    if [[ -d "${BRANCH_LOCKS_MUTEX_DIR}" ]]; then
      local mtime now
      mtime="$(stat -f %m "${BRANCH_LOCKS_MUTEX_DIR}" 2>/dev/null \
                || stat -c %Y "${BRANCH_LOCKS_MUTEX_DIR}" 2>/dev/null \
                || echo "")"
      now="$(date +%s)"
      if [[ -n "${mtime}" ]] && (( mtime > 0 )) \
         && (( now - mtime > 2 * BRANCH_LOCKS_TIMEOUT_SEC )); then
        echo "branch-locks: stale mutex (age=$((now-mtime))s) — reaping" >&2
        rm -rf "${BRANCH_LOCKS_MUTEX_DIR}"
        continue
      fi
    fi
    if (( waited >= BRANCH_LOCKS_TIMEOUT_SEC )); then
      echo "branch-locks: shell mutex timeout after ${waited}s" >&2
      return 75
    fi
    sleep "${sleep_step}"
    waited=$(( waited + sleep_step ))
  done
  # Release on any exit.
  trap 'rm -rf "${BRANCH_LOCKS_MUTEX_DIR}"' EXIT INT TERM
  "$@"
  local rc=$?
  rm -rf "${BRANCH_LOCKS_MUTEX_DIR}"
  trap - EXIT INT TERM
  return ${rc}
}

# Public: run <cmd...> while holding the branch-locks mutex.
branch_locks_with_mutex() {
  __branch_locks_ensure_files
  if command -v flock >/dev/null 2>&1; then
    # Open fd 9 to lockfile for flock.
    exec 9>"${BRANCH_LOCKS_LOCKFILE}"
    __branch_locks_with_flock "$@"
    local rc=$?
    exec 9>&-
    return ${rc}
  else
    __branch_locks_with_shellmutex "$@"
  fi
}

# --- helpers -------------------------------------------------------------

branch_locks_read() {
  __branch_locks_ensure_files
  cat "${BRANCH_LOCKS_FILE}"
}

# Internal: replace file atomically with stdin contents.
__branch_locks_atomic_write() {
  local tmp
  tmp="$(mktemp "${BRANCH_LOCKS_FILE}.XXXXXX")"
  cat > "${tmp}"
  # Validate JSON before swapping in.
  if ! jq -e . >/dev/null < "${tmp}"; then
    echo "branch-locks: refusing to write invalid JSON" >&2
    rm -f "${tmp}"
    return 1
  fi
  mv "${tmp}" "${BRANCH_LOCKS_FILE}"
}

# Internal command bodies — only invoked under the mutex.
__branch_locks_set_entry_impl() {
  local task_id="$1"
  local entry_json="$2"
  jq --arg id "${task_id}" --argjson entry "${entry_json}" \
     '. + {($id): $entry}' "${BRANCH_LOCKS_FILE}" \
    | __branch_locks_atomic_write
}

__branch_locks_remove_entry_impl() {
  local task_id="$1"
  jq --arg id "${task_id}" 'del(.[$id])' "${BRANCH_LOCKS_FILE}" \
    | __branch_locks_atomic_write
}

__branch_locks_set_status_impl() {
  local task_id="$1"
  local status="$2"
  jq --arg id "${task_id}" --arg s "${status}" \
     '.[$id].status = $s' "${BRANCH_LOCKS_FILE}" \
    | __branch_locks_atomic_write
}

# Public helpers — wrap each write in the mutex.
branch_locks_set_entry() {
  local task_id="$1"
  local entry_json="$2"
  branch_locks_with_mutex __branch_locks_set_entry_impl "${task_id}" "${entry_json}"
}

branch_locks_remove_entry() {
  local task_id="$1"
  branch_locks_with_mutex __branch_locks_remove_entry_impl "${task_id}"
}

branch_locks_set_status() {
  local task_id="$1"
  local status="$2"
  branch_locks_with_mutex __branch_locks_set_status_impl "${task_id}" "${status}"
}

# CLI dispatcher — `bash scripts/lib/branch-locks.sh <subcmd> <args>`.
# Lets shell-only callers (orchestrate.md, hooks) invoke helpers without
# needing to `source` the file.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-}"; shift || true
  case "${cmd}" in
    read)         branch_locks_read ;;
    set-entry)    branch_locks_set_entry "$@" ;;
    remove-entry) branch_locks_remove_entry "$@" ;;
    set-status)   branch_locks_set_status "$@" ;;
    with-mutex)   branch_locks_with_mutex "$@" ;;
    *)
      cat >&2 <<EOF
usage: branch-locks.sh <subcmd> [args]
  read
  set-entry <task_id> <entry_json>
  remove-entry <task_id>
  set-status <task_id> <status>
  with-mutex <cmd> [args...]
EOF
      exit 2
      ;;
  esac
fi
