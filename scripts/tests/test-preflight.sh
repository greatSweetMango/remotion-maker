#!/usr/bin/env bash
# Unit tests for scripts/orchestrator/preflight.sh (TM-207).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="${HERE}/orchestrator/preflight.sh"

if [[ ! -f "${HOOK}" ]]; then
  echo "[test] FAIL: missing ${HOOK}"
  exit 1
fi

sandbox="$(mktemp -d -t preflight-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT

# Build a fully-bootstrapped fake worktree for a given port.
make_wt() {
  local dir="$1" port="$2"
  mkdir -p "${dir}/node_modules/.prisma/client"
  printf 'NEXTAUTH_URL=http://127.0.0.1:%s\nDATABASE_URL=file:%s/prisma/dev.db\nOPENAI_API_KEY=sk-test-xxx\n' \
    "${port}" "${dir}" > "${dir}/.env.local"
  : > "${dir}/node_modules/.prisma/client/client.js"
}

# Assert exit code AND that `ok` field in JSON matches expectation.
run_case() {
  local desc="$1" want_exit="$2" want_ok="$3"; shift 3
  set +e
  out="$("$@" 2>/dev/null)"
  got=$?
  set -e
  if [[ "${got}" -ne "${want_exit}" ]]; then
    echo "[test] FAIL ${desc}: expected exit ${want_exit}, got ${got} (out: ${out})"
    exit 1
  fi
  if [[ -n "${want_ok}" ]]; then
    ok="$(printf '%s' "${out}" | jq -r '.ok')"
    if [[ "${ok}" != "${want_ok}" ]]; then
      echo "[test] FAIL ${desc}: expected ok=${want_ok}, got ok=${ok} (out: ${out})"
      exit 1
    fi
  fi
  echo "[test] OK ${desc} → exit ${want_exit}${want_ok:+ ok=${want_ok}}"
}

# Assert a specific missing-code is present in the JSON .missing[] array.
assert_missing() {
  local desc="$1" code="$2"; shift 2
  out="$("$@" 2>/dev/null || true)"
  if ! printf '%s' "${out}" | jq -e --arg c "${code}" '.missing | index($c)' >/dev/null; then
    echo "[test] FAIL ${desc}: expected missing[] to contain ${code} (out: ${out})"
    exit 1
  fi
  echo "[test] OK ${desc} → missing contains ${code}"
}

# --- Case 1: bootstrapped worktree, env-only → pass ---
wt1="${sandbox}/wt-3207"; make_wt "${wt1}" 3207
run_case "bootstrapped env-only passes" 0 "true" bash "${HOOK}" "${wt1}" 3207

# --- Case 2: NEXTAUTH_URL port mismatch → fail 20 ---
run_case "port mismatch fails" 20 "false" bash "${HOOK}" "${wt1}" 9999
assert_missing "port mismatch code" "NEXTAUTH_URL_PORT_MISMATCH" bash "${HOOK}" "${wt1}" 9999

# --- Case 3: missing .env.local → fail 20 ---
wt3="${sandbox}/wt-noenv"; mkdir -p "${wt3}/node_modules/.prisma/client"; : > "${wt3}/node_modules/.prisma/client/client.js"
run_case "missing .env.local fails" 20 "false" bash "${HOOK}" "${wt3}" 3300
assert_missing "missing env code" "ENV_LOCAL_MISSING" bash "${HOOK}" "${wt3}" 3300

# --- Case 4: missing prisma client → fail 20 ---
wt4="${sandbox}/wt-noprisma"; mkdir -p "${wt4}"
printf 'NEXTAUTH_URL=http://127.0.0.1:3400\n' > "${wt4}/.env.local"
run_case "missing prisma client fails" 20 "false" bash "${HOOK}" "${wt4}" 3400
assert_missing "missing prisma code" "PRISMA_CLIENT_MISSING" bash "${HOOK}" "${wt4}" 3400

# --- Case 5: missing worktree dir → fail 20 ---
run_case "missing worktree fails" 20 "false" bash "${HOOK}" "${sandbox}/nope" 3207

# --- Case 6: usage error (no port) → 64 ---
run_case "usage error" 64 "" bash "${HOOK}" "${wt1}"

# --- Case 7: key-less env, env-only → pass (graceful, core acceptance) ---
wt7="${sandbox}/wt-nokey"; mkdir -p "${wt7}/node_modules/.prisma/client"; : > "${wt7}/node_modules/.prisma/client/client.js"
printf 'NEXTAUTH_URL=http://127.0.0.1:3700\n' > "${wt7}/.env.local"
run_case "key-less env-only passes (graceful)" 0 "true" \
  env -u OPENAI_API_KEY bash "${HOOK}" "${wt7}" 3700

# --- Case 8: --require-live without key → KEY_MISSING + fail 20 ---
run_case "require-live missing key fails" 20 "false" \
  env -u OPENAI_API_KEY bash "${HOOK}" "${wt7}" 3700 --require-live
assert_missing "require-live key code" "KEY_MISSING:OPENAI_API_KEY" \
  env -u OPENAI_API_KEY bash "${HOOK}" "${wt7}" 3700 --require-live

# --- Case 9: --require-live, key present but dev server down → DEV_SERVER_UNREACHABLE ---
assert_missing "require-live dev-server probe" "DEV_SERVER_UNREACHABLE" \
  bash "${HOOK}" "${wt1}" 3207 --require-live

# --- Case 10: unknown flag → usage error 64 ---
run_case "unknown flag rejected" 64 "" bash "${HOOK}" "${wt1}" 3207 --bogus

echo "[test] all preflight.sh tests passed"
