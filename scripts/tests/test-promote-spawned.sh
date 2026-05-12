#!/usr/bin/env bash
# Unit tests for scripts/orchestrator/promote-spawned.sh (TM-97).
#
# Uses PROMOTE_DRY_RUN to bypass real task-master invocation. We still
# require `task-master` binary on PATH for the existence check; if missing,
# we stub it for the duration of the test.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="${HERE}/orchestrator/promote-spawned.sh"

if [[ ! -f "${HOOK}" ]]; then
  echo "[test] FAIL: missing ${HOOK}"
  exit 1
fi

sandbox="$(mktemp -d -t promote-test.XXXXXX)"
trap 'rm -rf "${sandbox}"' EXIT

# Stub task-master so promote-spawned.sh's PATH check passes during dry-run.
stub_bin="${sandbox}/bin"
mkdir -p "${stub_bin}"
cat >"${stub_bin}/task-master" <<'EOF'
#!/usr/bin/env bash
echo "task-master stub: $*" >&2
echo "Task #999 added"
exit 0
EOF
chmod +x "${stub_bin}/task-master"
export PATH="${stub_bin}:${PATH}"
# Test harness bypasses worktree guard (tests run inside the worktree itself).
export PROMOTE_SKIP_CWD_CHECK=1

# Case 1: empty array → []
out="$(echo '[]' | bash "${HOOK}" - 2>/dev/null)"
if [[ "${out}" != "[]" ]]; then
  echo "[test] FAIL empty array: got '${out}'"
  exit 1
fi
echo "[test] OK empty array returns []"

# Case 2: malformed input → exit 2
set +e
echo 'not-json' | bash "${HOOK}" - >/dev/null 2>&1
rc=$?
set -e
if [[ "${rc}" -ne 2 ]]; then
  echo "[test] FAIL malformed input: expected 2, got ${rc}"
  exit 1
fi
echo "[test] OK malformed input → exit 2"

# Case 3: missing title → exit 2
set +e
echo '[{"description":"x"}]' | PROMOTE_DRY_RUN=1 bash "${HOOK}" - >/dev/null 2>&1
rc=$?
set -e
if [[ "${rc}" -ne 2 ]]; then
  echo "[test] FAIL missing title: expected 2, got ${rc}"
  exit 1
fi
echo "[test] OK missing title → exit 2"

# Case 4: dry-run with valid entries → returns JSON mapping
input='[{"placeholder_id":"TM-97-spawn-1","title":"AI-BUG-foo","description":"desc","priority":"high"},
        {"placeholder_id":"TM-97-spawn-2","title":"AI-BUG-bar","description":"desc2"}]'
out="$(echo "${input}" | PROMOTE_DRY_RUN=1 bash "${HOOK}" - 2>/dev/null)"
if ! echo "${out}" | jq -e 'length == 2' >/dev/null; then
  echo "[test] FAIL dry-run length: got '${out}'"
  exit 1
fi
if ! echo "${out}" | jq -e '.[0].placeholder_id == "TM-97-spawn-1" and .[0].canonical_id == "DRY-0"' >/dev/null; then
  echo "[test] FAIL dry-run mapping: got '${out}'"
  exit 1
fi
echo "[test] OK dry-run returns canonical mapping"

# Case 5: without skip, running from inside this worktree → blocked with exit 20
set +e
echo '[]' | PROMOTE_SKIP_CWD_CHECK= bash "${HOOK}" - >/dev/null 2>&1
rc=$?
set -e
if [[ "${rc}" -ne 20 ]]; then
  echo "[test] FAIL worktree guard: expected 20, got ${rc}"
  exit 1
fi
echo "[test] OK worktree guard blocks invocation from worktree → exit 20"

echo "[test] all promote-spawned.sh tests passed"
