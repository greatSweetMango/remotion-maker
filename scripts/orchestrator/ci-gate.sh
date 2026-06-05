#!/usr/bin/env bash
# scripts/orchestrator/ci-gate.sh
#
# TM-208 — Hard CI merge gate + chronically-red detection (ADR-PENDING-TM-208).
#
# Run by the Orchestrator in orchestrate.md Step 5 (APPROVE branch) *immediately
# before* `gh pr merge`. Its job: refuse to merge a PR whose CI is red, so a
# broken build never lands on main via the autonomous loop.
#
# But a *blanket* "all checks must be green" gate would deadlock the whole
# merge pipeline, because one check ('Lint — circular dependencies') has been
# chronically red for weeks (exit 127 — `depcruise` is not installed; that
# infra fix is tracked as a separate spawned task, NOT this one). So this gate
# splits red checks into two buckets:
#
#   * known-broken (allowlisted)  → does NOT block the merge (logged only)
#   * everything else red/failing → blocks the merge (exit 20)
#
# This mirrors the OpenAI Swarm *output guardrail* pattern: validate the side
# effect (the merge) before committing it. It is strictly additive — it makes
# the merge path *more* strict. It never weakens the STOP / stop-guard
# guardrails: a green/known-broken-only PR exits 0 exactly as merges did before
# this gate existed.
#
# Allowlist management (no hardcoding beyond a conservative default):
#   * env  CI_GATE_KNOWN_RED   — newline- or comma-separated check-name
#                                substrings to treat as known-broken.
#   * file scripts/orchestrator/ci-gate-allowlist.txt — one substring per line
#                                (# comments + blank lines ignored).
#   * built-in default          — 'Lint — circular dependencies' (the one
#                                check we know is chronically red today).
# A check is allowlisted if any allowlist entry is a substring of its name.
#
# Pending checks: bounded wait. We re-poll `gh pr checks` up to
# CI_GATE_MAX_WAIT seconds (default 180, capped) with CI_GATE_POLL_INTERVAL
# (default 15) between polls. Still-pending after the budget → treated as a
# blocking failure (exit 20) so we never merge on top of unfinished CI.
#
# Chronically-red detection (best-effort telemetry): each non-allowlisted red
# check seen is appended to .agent-state/ci-gate-red-history.jsonl. If the same
# check name has been red across >= CI_GATE_CHRONIC_K (default 3) recent PRs we
# emit an "allowlist candidate" line to stderr so a human/ADR can promote it.
# This is logging only — it NEVER auto-allowlists and never changes exit codes.
#
# Pure bash + gh + jq. No new npm deps.
#
# Testability: the raw `gh pr checks` invocation is funneled through one
# function `_fetch_checks`. Tests inject mock output via:
#   * env CI_GATE_CHECKS_CMD — a shell command whose stdout replaces
#                              `gh pr checks` (evaluated each poll), or
#   * env CI_GATE_CHECKS_FILE — a file whose contents replace it.
# When neither is set we call the real `gh pr checks <pr> --json ...`.
#
# Usage:
#   bash scripts/orchestrator/ci-gate.sh <pr_number>
#
# Output (stdout): a single JSON object, e.g.
#   {"ok":true,"pr":"123","decision":"green","blocking":[],"known_red":[],"pending":[]}
#   {"ok":false,"pr":"123","decision":"red","blocking":["E2E"],"known_red":["Lint — circular dependencies"],"pending":[]}
#
# Exit codes:
#   0   — mergeable: every check is green/skipped, or the only red checks are
#         allowlisted (known-broken).
#  20   — blocked: at least one non-allowlisted check is failing, or checks are
#         still pending after the wait budget. Orchestrator → hold merge +
#         escalate task blocked.
#  64   — usage error (bad args).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ALLOWLIST_FILE="${CI_GATE_ALLOWLIST_FILE:-${SCRIPT_DIR}/ci-gate-allowlist.txt}"
RED_HISTORY="${CI_GATE_RED_HISTORY:-${REPO_ROOT}/.agent-state/ci-gate-red-history.jsonl}"

# --- defaults (env-overridable) ---------------------------------------------
MAX_WAIT="${CI_GATE_MAX_WAIT:-180}"
POLL_INTERVAL="${CI_GATE_POLL_INTERVAL:-15}"
CHRONIC_K="${CI_GATE_CHRONIC_K:-3}"
# cap the wait so a runaway env value can't hang the loop forever
[[ "${MAX_WAIT}" =~ ^[0-9]+$ ]] || MAX_WAIT=180
(( MAX_WAIT > 600 )) && MAX_WAIT=600
[[ "${POLL_INTERVAL}" =~ ^[0-9]+$ ]] || POLL_INTERVAL=15
(( POLL_INTERVAL < 1 )) && POLL_INTERVAL=1

PR="${1:-}"
if [[ -z "${PR}" ]]; then
  echo '{"ok":false,"decision":"usage","reason":"missing <pr_number>"}' >&2
  exit 64
fi

# ---------------------------------------------------------------------------
# Build the allowlist (substrings). Built-in default + file + env, deduped.
# ---------------------------------------------------------------------------
ALLOW_ENTRIES=()
ALLOW_ENTRIES+=("Lint — circular dependencies")   # known chronically-red (TM-208)

if [[ -f "${ALLOWLIST_FILE}" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"                 # strip trailing comment
    line="${line#"${line%%[![:space:]]*}"}"  # ltrim
    line="${line%"${line##*[![:space:]]}"}"  # rtrim
    [[ -n "${line}" ]] && ALLOW_ENTRIES+=("${line}")
  done < "${ALLOWLIST_FILE}"
fi

if [[ -n "${CI_GATE_KNOWN_RED:-}" ]]; then
  # accept comma- or newline-separated
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "${line}" ]] && ALLOW_ENTRIES+=("${line}")
  done < <(printf '%s\n' "${CI_GATE_KNOWN_RED}" | tr ',' '\n')
fi

# Is the given check name allowlisted (entry is a substring of name)?
is_allowlisted() {
  local name="$1" entry
  for entry in "${ALLOW_ENTRIES[@]}"; do
    [[ -n "${entry}" && "${name}" == *"${entry}"* ]] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Fetch checks. Normalizes to JSON array of {name,bucket} where bucket is one
# of: pass | fail | pending  (skipped/neutral fold into pass).
#
# Real source: `gh pr checks <pr> --json name,state,bucket`. gh already groups
# states into a `bucket` field (pass|fail|pending|skipping|cancel). We map it.
# Mock source: CI_GATE_CHECKS_CMD / CI_GATE_CHECKS_FILE producing the same JSON
# array (so tests don't need gh).
# ---------------------------------------------------------------------------
_raw_checks() {
  if [[ -n "${CI_GATE_CHECKS_CMD:-}" ]]; then
    eval "${CI_GATE_CHECKS_CMD}"
  elif [[ -n "${CI_GATE_CHECKS_FILE:-}" ]]; then
    cat "${CI_GATE_CHECKS_FILE}"
  else
    # gh exits non-zero when any check is failing/pending; we want the data
    # regardless, so swallow the exit and rely on the JSON.
    gh pr checks "${PR}" --json name,state,bucket 2>/dev/null || true
  fi
}

# Emit normalized JSON array [{"name":..,"bucket":pass|fail|pending}, ...]
normalize_checks() {
  local raw
  raw="$(_raw_checks)"
  [[ -z "${raw// }" ]] && raw='[]'
  printf '%s' "${raw}" | jq -c '
    [ .[]
      | { name: .name,
          bucket: (
            (.bucket // .state // "" | ascii_downcase) as $b
            | if   $b == "pass" or $b == "success" or $b == "skipping"
                   or $b == "skipped" or $b == "neutral" or $b == "cancel"
                   or $b == "cancelled"
              then "pass"
            elif   $b == "pending" or $b == "queued" or $b == "in_progress"
                   or $b == "" or $b == "expected" or $b == "waiting"
              then "pending"
            else "fail"
            end )
        }
    ]' 2>/dev/null || printf '[]'
}

# ---------------------------------------------------------------------------
# Poll loop: re-evaluate until no pending (or wait budget exhausted).
# ---------------------------------------------------------------------------
checks_json="[]"
waited=0
while :; do
  checks_json="$(normalize_checks)"
  pending_count="$(printf '%s' "${checks_json}" | jq '[.[]|select(.bucket=="pending")]|length')"
  if [[ "${pending_count}" -eq 0 ]]; then
    break
  fi
  if (( waited >= MAX_WAIT )); then
    break   # budget exhausted; still-pending handled below as blocking
  fi
  sleep "${POLL_INTERVAL}"
  waited=$(( waited + POLL_INTERVAL ))
done

# ---------------------------------------------------------------------------
# Partition: blocking (non-allowlisted fail OR still-pending) vs known_red.
# ---------------------------------------------------------------------------
mapfile -t fail_names < <(printf '%s' "${checks_json}" | jq -r '.[]|select(.bucket=="fail")|.name')
mapfile -t pending_names < <(printf '%s' "${checks_json}" | jq -r '.[]|select(.bucket=="pending")|.name')

blocking=()
known_red=()
for name in "${fail_names[@]}"; do
  [[ -z "${name}" ]] && continue
  if is_allowlisted "${name}"; then
    known_red+=("${name}")
  else
    blocking+=("${name}")
  fi
done
# still-pending after budget → blocking (never merge over unfinished CI)
for name in "${pending_names[@]}"; do
  [[ -z "${name}" ]] && continue
  blocking+=("${name} (pending)")
done

# ---------------------------------------------------------------------------
# chronically-red detection (best-effort). Record each known-red occurrence,
# then warn if any *blocking* check has been red across >= CHRONIC_K recent PRs
# (candidate for allowlisting).
# ---------------------------------------------------------------------------
record_red_history() {
  mkdir -p "$(dirname "${RED_HISTORY}")" 2>/dev/null || return 0
  local ts name
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
  for name in "${known_red[@]}" "${blocking[@]}"; do
    [[ -z "${name}" ]] && continue
    printf '%s\n' "$(jq -cn --arg pr "${PR}" --arg n "${name}" --arg t "${ts}" \
      '{ts:$t,pr:$pr,check:$n}')" >> "${RED_HISTORY}" 2>/dev/null || true
  done
}
record_red_history

detect_chronic() {
  [[ -f "${RED_HISTORY}" ]] || return 0
  local name distinct
  for name in "${blocking[@]}"; do
    [[ -z "${name}" ]] && continue
    # count distinct PRs in which this exact check was red
    distinct="$(jq -r --arg n "${name}" 'select(.check==$n)|.pr' "${RED_HISTORY}" 2>/dev/null \
                | sort -u | wc -l | tr -d ' ')"
    if [[ "${distinct}" =~ ^[0-9]+$ ]] && (( distinct >= CHRONIC_K )); then
      echo "[ci-gate] chronically-red candidate: '${name}' red across ${distinct} PRs (>= ${CHRONIC_K}) — consider adding to CI_GATE_KNOWN_RED / ${ALLOWLIST_FILE}" >&2
    fi
  done
}
detect_chronic

# ---------------------------------------------------------------------------
# Verdict.
# ---------------------------------------------------------------------------
blocking_json="$(printf '%s\n' "${blocking[@]}" | jq -R . | jq -s -c 'map(select(length>0))')"
known_red_json="$(printf '%s\n' "${known_red[@]}" | jq -R . | jq -s -c 'map(select(length>0))')"
pending_json="$(printf '%s\n' "${pending_names[@]}" | jq -R . | jq -s -c 'map(select(length>0))')"

if (( ${#blocking[@]} == 0 )); then
  decision="green"
  (( ${#known_red[@]} > 0 )) && decision="known-red-only"
  jq -cn --arg pr "${PR}" --arg d "${decision}" \
     --argjson b "${blocking_json}" --argjson k "${known_red_json}" --argjson p "${pending_json}" \
     '{ok:true,pr:$pr,decision:$d,blocking:$b,known_red:$k,pending:$p}'
  exit 0
else
  jq -cn --arg pr "${PR}" \
     --argjson b "${blocking_json}" --argjson k "${known_red_json}" --argjson p "${pending_json}" \
     '{ok:false,pr:$pr,decision:"red",blocking:$b,known_red:$k,pending:$p}'
  exit 20
fi
