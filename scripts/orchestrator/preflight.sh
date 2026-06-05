#!/usr/bin/env bash
# scripts/orchestrator/preflight.sh
#
# TM-207 — fail-fast preflight guardrail (ADR-PENDING-TM-207).
#
# Cheap, dependency-free sanity check run by the Orchestrator *just before*
# dispatching a TeamLead Agent to a worktree. Its job is to convert the
# expensive "mystery 600s death" (a TeamLead spins up, burns minutes, then
# dies because its worktree was never bootstrapped or a required key is
# missing) into an immediate "blocked: <clear reason>" verdict.
#
# This mirrors the OpenAI Swarm *input guardrail* pattern: validate the
# inputs to an agent run before paying for the run itself.
#
# Two tiers of check:
#   (a) ALWAYS (env-only — no secrets required): the worktree was bootstrapped.
#         - <worktree>/.env.local exists
#         - NEXTAUTH_URL inside it targets <dev_port>
#         - a generated Prisma client is resolvable from the worktree
#       Code/docs tasks need nothing more — they never hit the live app or
#       external APIs — so this tier MUST pass in the key-less CI/dev box.
#   (b) --require-live ONLY (for tasks that exercise the running app / LLM):
#         - required API keys are present & non-empty (OPENAI_API_KEY, ...)
#         - the dev server answers on localhost:<dev_port> (short curl timeout)
#
# Pure bash + curl + jq. No new npm deps. Additive: a failure only tells the
# Orchestrator to mark the task `blocked` — it never weakens the loop/STOP
# guards.
#
# Usage:
#   bash scripts/orchestrator/preflight.sh <worktree_path> <dev_port> [--require-live]
#
# Output (stdout): a single JSON object:
#   {"ok":true,"missing":[],"reason":"..."}
#   {"ok":false,"missing":["NEXTAUTH_URL_PORT_MISMATCH"],"reason":"..."}
#
# Exit codes:
#   0  — all checks passed (ok:true)
#  20  — at least one check failed (ok:false)  ← Orchestrator → set-status blocked
#  64  — usage error (bad args)

set -euo pipefail

# ---- arg parsing ------------------------------------------------------------

REQUIRE_LIVE=0
POSITIONAL=()
for arg in "$@"; do
  case "${arg}" in
    --require-live) REQUIRE_LIVE=1 ;;
    --*) echo "preflight.sh: unknown flag: ${arg}" >&2; exit 64 ;;
    *) POSITIONAL+=("${arg}") ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ne 2 ]]; then
  echo "preflight.sh: usage: bash scripts/orchestrator/preflight.sh <worktree_path> <dev_port> [--require-live]" >&2
  exit 64
fi

WORKTREE_PATH="${POSITIONAL[0]}"
DEV_PORT="${POSITIONAL[1]}"

if [[ ! "${DEV_PORT}" =~ ^[0-9]+$ ]]; then
  echo "preflight.sh: dev_port must be numeric, got: ${DEV_PORT}" >&2
  exit 64
fi

# Comma-separated list of API keys treated as required under --require-live.
# Overridable via env so callers can extend without editing this script.
REQUIRED_LIVE_KEYS="${PREFLIGHT_REQUIRED_KEYS:-OPENAI_API_KEY}"

# ---- accumulators -----------------------------------------------------------

MISSING=()        # machine-readable codes
REASONS=()        # human-readable phrases

note() { MISSING+=("$1"); REASONS+=("$2"); }

# ---- (a) env-only checks (always run) --------------------------------------

if [[ ! -d "${WORKTREE_PATH}" ]]; then
  note "WORKTREE_MISSING" "worktree path does not exist: ${WORKTREE_PATH}"
else
  ABS_WT="$(cd "${WORKTREE_PATH}" && pwd -P)"
  ENV_FILE="${ABS_WT}/.env.local"

  if [[ ! -f "${ENV_FILE}" ]]; then
    note "ENV_LOCAL_MISSING" ".env.local not found at ${ENV_FILE} — worktree not bootstrapped (run scripts/setup-worktree.sh)"
  else
    # NEXTAUTH_URL must target the assigned dev_port. Parse the last matching
    # line (ignore comments / blank). We extract the port after the final ':'.
    nauth_line="$(grep -E '^[[:space:]]*NEXTAUTH_URL=' "${ENV_FILE}" | tail -n1 || true)"
    if [[ -z "${nauth_line}" ]]; then
      note "NEXTAUTH_URL_MISSING" "NEXTAUTH_URL not set in ${ENV_FILE}"
    else
      nauth_val="${nauth_line#*=}"
      nauth_val="${nauth_val%\"}"; nauth_val="${nauth_val#\"}"   # strip optional quotes
      nauth_val="${nauth_val%\'}"; nauth_val="${nauth_val#\'}"
      # host:port[/path] → grab the digits immediately after the last ':'.
      nauth_port="$(printf '%s' "${nauth_val}" | sed -E 's#.*:([0-9]+).*#\1#')"
      if [[ ! "${nauth_port}" =~ ^[0-9]+$ ]]; then
        note "NEXTAUTH_URL_NO_PORT" "NEXTAUTH_URL has no parseable port: ${nauth_val}"
      elif [[ "${nauth_port}" != "${DEV_PORT}" ]]; then
        note "NEXTAUTH_URL_PORT_MISMATCH" "NEXTAUTH_URL port ${nauth_port} != dev_port ${DEV_PORT} (cookie-jar / redirect mismatch — re-run setup-worktree.sh)"
      fi
    fi
  fi

  # Prisma client must be generated for this worktree. Without it the dev
  # server falls back to the main repo's client (TM-46 r6) or crashes on boot.
  if [[ ! -e "${ABS_WT}/node_modules/.prisma/client/client.js" \
     && ! -e "${ABS_WT}/node_modules/.prisma/client/index.js" \
     && ! -e "${ABS_WT}/node_modules/@prisma/client/index.js" ]]; then
    note "PRISMA_CLIENT_MISSING" "generated Prisma client not found under ${ABS_WT}/node_modules — run scripts/setup-worktree.sh (prisma generate)"
  fi
fi

# ---- (b) live checks (only with --require-live) -----------------------------

if [[ "${REQUIRE_LIVE}" -eq 1 ]]; then
  # Required API keys — present & non-empty. Look in the worktree .env.local
  # first, then fall back to the process environment.
  IFS=',' read -r -a _keys <<< "${REQUIRED_LIVE_KEYS}"
  for key in "${_keys[@]}"; do
    key="$(printf '%s' "${key}" | tr -d '[:space:]')"
    [[ -z "${key}" ]] && continue
    val=""
    if [[ -n "${ABS_WT:-}" && -f "${ABS_WT}/.env.local" ]]; then
      kline="$(grep -E "^[[:space:]]*${key}=" "${ABS_WT}/.env.local" | tail -n1 || true)"
      if [[ -n "${kline}" ]]; then
        val="${kline#*=}"
        val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
      fi
    fi
    if [[ -z "${val}" ]]; then
      val="$(printenv "${key}" 2>/dev/null || true)"
    fi
    if [[ -z "${val}" ]]; then
      note "KEY_MISSING:${key}" "required API key ${key} is unset/empty (needed for --require-live run)"
    fi
  done

  # Dev server reachability — short timeout so we never hang the loop.
  if command -v curl >/dev/null 2>&1; then
    if ! curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:${DEV_PORT}/" \
       && ! curl -sf -o /dev/null --max-time 3 "http://localhost:${DEV_PORT}/"; then
      note "DEV_SERVER_UNREACHABLE" "no HTTP response from localhost:${DEV_PORT} within 3s (dev server not running?)"
    fi
  else
    note "CURL_UNAVAILABLE" "curl not found — cannot probe dev server reachability"
  fi
fi

# ---- emit JSON --------------------------------------------------------------

if [[ ${#MISSING[@]} -eq 0 ]]; then
  if [[ "${REQUIRE_LIVE}" -eq 1 ]]; then
    reason="preflight passed (env + live checks ok for dev_port ${DEV_PORT})"
  else
    reason="preflight passed (env-only checks ok for dev_port ${DEV_PORT})"
  fi
  printf '{"ok":true,"missing":[],"reason":%s}\n' "$(jq -Rn --arg r "${reason}" '$r')"
  exit 0
fi

# Build JSON array of missing codes and a joined human reason.
missing_json="$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s -c .)"
reason="$(IFS='; '; echo "${REASONS[*]}")"
printf '{"ok":false,"missing":%s,"reason":%s}\n' \
  "${missing_json}" "$(jq -Rn --arg r "${reason}" '$r')"
exit 20
