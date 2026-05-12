#!/usr/bin/env bash
# scripts/pre-pr.sh
#
# Pre-PR-creation guard. TeamLead MUST call this in Phase D before
# `gh pr create`. Goals:
#
#   1. Refuse to create a duplicate PR for the same branch (TM-55 / TM-85
#      race: a TeamLead background task creating a second PR after the
#      main session already merged the first one).
#   2. Refuse to create a PR whose head branch was already merged
#      (orphaned background work).
#   3. Surface the existing PR URL/number so TeamLead can reuse it
#      (post a comment) instead of opening a second one.
#
# Exit codes:
#   0  — branch has no open or merged PR, safe to `gh pr create`.
#   10 — branch already has an OPEN PR. Stdout: existing PR URL+number.
#         TeamLead SHOULD: skip create, push extra commits to same branch,
#         and append a comment to the existing PR.
#   11 — branch was already MERGED. Stdout: merged PR URL+number.
#         TeamLead SHOULD: abort and report "merged_elsewhere" in summary.
#   12 — branch has a CLOSED (not merged) PR. Stdout: closed PR info.
#         TeamLead may still create a new PR but must justify it.
#   2  — usage error.
#   1  — environment error (gh not authed, branch missing, etc.).
#
# Usage:
#   bash scripts/pre-pr.sh <branch>                 # explicit
#   bash scripts/pre-pr.sh                          # use current branch
#
# Output (on duplicate, machine-readable):
#   STATE=open|merged|closed
#   PR_NUMBER=123
#   PR_URL=https://github.com/.../pull/123
#   PR_TITLE=...

set -euo pipefail

branch="${1:-}"
if [[ -z "${branch}" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi

if [[ -z "${branch}" || "${branch}" == "HEAD" ]]; then
  echo "pre-pr.sh: cannot determine branch (pass as arg or check out a branch)" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "pre-pr.sh: gh CLI not installed" >&2
  exit 1
fi

# `gh pr list --head <branch> --state all --json ...`
# Allow a mock override for tests: PRE_PR_GH_CMD="cat fixtures/foo.json".
list_prs() {
  if [[ -n "${PRE_PR_GH_CMD:-}" ]]; then
    eval "${PRE_PR_GH_CMD}"
  else
    gh pr list --head "${branch}" --state all \
      --json number,url,state,title,mergedAt 2>/dev/null
  fi
}

raw="$(list_prs || true)"
if [[ -z "${raw}" ]]; then raw="[]"; fi

# Pick the most relevant PR:
#   priority: OPEN > MERGED > CLOSED, then by highest number.
pick='
  ( map(select(.state == "OPEN"))   | sort_by(-.number) ) +
  ( map(select(.state == "MERGED")) | sort_by(-.number) ) +
  ( map(select(.state == "CLOSED"))| sort_by(-.number) )
  | .[0] // empty
'
pr="$(printf '%s' "${raw}" | jq -c "${pick}")"

if [[ -z "${pr}" || "${pr}" == "null" ]]; then
  echo "pre-pr.sh: no existing PR for branch '${branch}' — safe to create"
  exit 0
fi

state="$(jq -r '.state' <<<"${pr}")"
num="$(jq -r '.number' <<<"${pr}")"
url="$(jq -r '.url' <<<"${pr}")"
title="$(jq -r '.title' <<<"${pr}")"

cat <<EOF
STATE=${state}
PR_NUMBER=${num}
PR_URL=${url}
PR_TITLE=${title}
EOF

case "${state}" in
  OPEN)
    echo "pre-pr.sh: BLOCK — branch '${branch}' already has open PR #${num} (${url})" >&2
    echo "pre-pr.sh: action — push commits to same branch + comment on PR, do NOT create a new one" >&2
    exit 10
    ;;
  MERGED)
    echo "pre-pr.sh: BLOCK — branch '${branch}' was already MERGED via PR #${num} (${url})" >&2
    echo "pre-pr.sh: action — abort PR creation; report merged_elsewhere in TeamLead summary" >&2
    exit 11
    ;;
  CLOSED)
    echo "pre-pr.sh: WARN — branch '${branch}' has a closed (not merged) PR #${num} (${url})" >&2
    echo "pre-pr.sh: action — new PR is allowed but justify in body" >&2
    exit 12
    ;;
  *)
    echo "pre-pr.sh: unknown state '${state}' for PR #${num} — failing closed" >&2
    exit 1
    ;;
esac
