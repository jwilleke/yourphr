#!/usr/bin/env bash
# sync-labels.sh — apply the standard label set to a repo.
#
# Idempotent: ADDS or UPDATES the standard labels (name, color, description).
# NEVER deletes labels — your repo-specific labels are left untouched.
#
# Usage:
#   utility/sync-labels.sh                 # current repo (gh infers from cwd)
#   utility/sync-labels.sh owner/repo      # a specific repo
#   utility/sync-labels.sh --all owner     # every active (non-archived, source) repo for owner
#
# Requires: gh (authenticated).

set -euo pipefail

# name|hexcolor|description
LABELS=(
  # --- Priority (mutually exclusive) ---
  "P0|b60205|Critical / security — do now"
  "P1|d93f0b|High priority"
  "P2|fbca04|Normal priority"
  "deferred|cccccc|Consciously postponed"
  "needs-triage|ededed|Open issue awaiting a priority decision"
  # --- State / type (additive) ---
  "security|DC2626|Security: vulnerability alert or security feature work"
  "in-review|0075ca|Shipped; awaiting operator verification"
  "blocked|000000|Blocked on an external dependency or decision"
  "dependencies|0366d6|Dependency updates (Dependabot)"
)

apply_to() {
  local repo_args=()
  [ -n "${1:-}" ] && repo_args=(-R "$1")
  echo "→ labels: ${1:-current repo}"
  local spec name color desc
  for spec in "${LABELS[@]}"; do
    IFS='|' read -r name color desc <<<"$spec"
    gh label create "$name" --color "$color" --description "$desc" --force "${repo_args[@]}" >/dev/null
    echo "   ✓ $name"
  done
}

if [ "${1:-}" = "--all" ]; then
  owner="${2:?usage: sync-labels.sh --all <owner>}"
  gh repo list "$owner" --no-archived --source --limit 200 --json nameWithOwner \
    --jq '.[].nameWithOwner' | while read -r r; do apply_to "$r"; done
else
  apply_to "${1:-}"
fi
