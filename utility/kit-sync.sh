#!/usr/bin/env bash
# kit-sync.sh — the body of the Kit Sync workflow.
#
# This lives in the kit rather than in .github/workflows/kit-sync.yml because
# GITHUB_TOKEN may not push a workflow file. Anything inside the workflow can
# only be updated by a human running install-kit.sh against all twelve repos;
# anything in here is an ordinary `overwrite` file that the sync itself delivers.
#
# That distinction is not theoretical. Every defect this mechanism has produced
# was in the logic, never in the trigger:
#
#   red on every push where Actions may not open PRs   logic
#   `git add -A` staging the kit checkout              logic
#   pushing a workflow file the token may not touch    logic
#   a pathspec fighting its own .gitignore             logic
#
# Each cost a manual round across the fleet. Held here, the next one does not.
#
# Usage: kit-sync.sh <kit-checkout-dir>
# Expects: GH_TOKEN, GITHUB_REF_NAME, GITHUB_REPOSITORY, GITHUB_SERVER_URL

set -euo pipefail

KIT="${1:?usage: kit-sync.sh <kit-checkout-dir>}"
BASE="${GITHUB_REF_NAME:?}"

behind() {
  node "$KIT/bin/kit.mjs" check . --kit "$KIT" --json >kit-status.json
  node -e '
    const s = require("./kit-status.json");
    const yes = s.status === "behind" || s.status === "unmarked" ||
                s.status === "unknown" || s.missing.length || s.modified.length;
    console.log(`status=${s.status} behind=${!!yes}`);
    process.exit(yes ? 0 : 1);
  '
}

if ! behind; then
  echo "Already current with the kit."
  exit 0
fi

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
"$KIT/install-kit.sh" .

# GitHub does not start workflow runs for a PR opened by GITHUB_TOKEN, so the
# checks on that PR would never arrive. Gate here instead, where the change
# already exists: a sync that breaks the kit's own markdown rules never becomes
# a PR at all, which is stricter than waiting for CI.
if ! npx --yes markdownlint-cli2 >kit-lint.txt 2>&1; then
  echo "The sync does not satisfy the kit's own markdown rules:"
  tail -40 kit-lint.txt
  node "$KIT/bin/kit.mjs" check . --kit "$KIT" --report-issue
  exit 0
fi

version="$(node -p "require('./.agent-kit.json').installed")"
branch="chore/kit-sync-$version"

# .kit-sync is excluded by .gitignore, which install-kit.sh writes. Naming it in
# a pathspec as well makes `git add` refuse an explicitly-listed ignored path.
#
# .github/workflows is excluded because GITHUB_TOKEN may not push it; the whole
# push is rejected otherwise. A human running install-kit.sh --pr delivers those.
# kit-status.json and kit-lint.txt are this script's own scratch output, written
# to the repo root and both read back above. Nothing gitignores them, so `git
# add -A` swept them into the sync commit: jwilleke/deby carried both on master
# from the v1.11.1 sync until an unrelated session caught it, and mj-infra-flux
# PR #175 shipped them too, spotted only because a clean duplicate PR existed to
# compare against (#68). Neither file is needed past this point.
rm -f kit-status.json kit-lint.txt

git checkout -b "$branch"
git add -A -- ':!.github/workflows'

if git diff --cached --quiet; then
  echo "::notice::The only pending kit change is under .github/workflows/, which"
  echo "::notice::GITHUB_TOKEN may not push. Run install-kit.sh --pr locally to deliver it."
  git checkout -q "$BASE"
  exit 0
fi

git commit -q -m "chore(kit): sync to $version"
git push -q -f -u origin "$branch"

if gh pr view "$branch" --json number >/dev/null 2>&1; then
  echo "PR already open for $branch."
  exit 0
fi

# #70: a base branch with required status checks can never merge this PR.
# GITHUB_TOKEN does not start workflow runs for events it creates, so the required
# checks never run, and the PR sits MERGEABLE but BLOCKED with no failure to notice
# — the checks that DO appear (CodeQL, GitGuardian) trigger independently and go
# green, which makes it look healthy. The sync cannot fix this; it can stop being
# silent about it. jwilleke/yourphr#562 sat blocked for a day this way.
required=""
if contexts="$(gh api "repos/{owner}/{repo}/branches/$BASE/protection/required_status_checks" \
                 --jq '.contexts[]?' 2>/dev/null)" && [ -n "$contexts" ]; then
  required="$(printf '%s' "$contexts" | sed 's/^/- `/; s/$/`/')"
fi

body="Automated kit sync applied by \`install-kit.sh\` from
[mjs-project-template](https://github.com/jwilleke/mjs-project-template).

Kit version: \`$version\`

The kit's own markdown lint ran against these changes before this PR was opened and passed.
GitHub does not start workflow runs for pull requests opened by \`GITHUB_TOKEN\`, so that in-job
check is the gate rather than the checks below.

Canonical kit files are overwritten wholesale; your own content is untouched, and \`AGENTS.md\`
changes stay between the \`KIT:START\` / \`KIT:END\` markers. If something here is wrong, fix it
upstream in the template — the next sync would overwrite a local fix.

Changes under \`.github/workflows/\` are not included: \`GITHUB_TOKEN\` may not push them."

if [ -n "$required" ]; then
  body="$body

---

**This PR cannot merge on its own.** \`$BASE\` requires these status checks:

$required

None of them will run here. GitHub does not start workflow runs for pull requests opened by
\`GITHUB_TOKEN\`, so the required checks stay pending forever and this PR sits blocked with
nothing red to notice.

To unblock it, make the checks fire under a user token:

- close and reopen this PR — works only if those workflows list \`reopened\` among their
  \`pull_request\` types
- otherwise push any commit to \`$branch\`

No admin bypass is needed either way."
fi

# P2 on creation: /pstatus places a PR by its own label first, and an unlabelled
# one lands in Needs triage in every repo on every release.
if gh pr create --base "$BASE" --head "$branch" \
     --label P2 --title "chore(kit): sync to $version" --body "$body" 2>kit-pr-error.txt; then
  exit 0
fi

cat kit-pr-error.txt

# "Allow GitHub Actions to create and approve pull requests" is off, which no
# `permissions:` block can grant. The branch is already pushed, so nothing is
# lost and there is nothing to retry — a red X here would recur on every push
# and mean neither "checked" nor "could not run".
if ! grep -q 'not permitted to create or approve pull requests' kit-pr-error.txt; then
  echo "::error::gh pr create failed for a reason other than the Actions PR setting"
  exit 1
fi

compare="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/compare/${BASE}...${branch}?expand=1"
echo "::notice::Sync branch pushed, but this repo does not allow Actions to open PRs: $compare"

marker="kit-sync:cannot-open-pr"
if [ "$(gh issue list --state open --search "$marker in:body" --json number --jq 'length')" != "0" ]; then
  echo "Tracking issue already open."
  exit 0
fi

gh issue create --label P2 \
  --title "[kit] Kit Sync cannot open its pull request" \
  --body "The kit sync ran and passed its own lint, but could not open the pull request:

\`\`\`text
$(cat kit-pr-error.txt)
\`\`\`

**Nothing is lost** — the branch \`$branch\` is pushed. Open the PR here:

$compare

## Fix it once

Settings > Actions > General > Workflow permissions, and tick
**Allow GitHub Actions to create and approve pull requests**.

That setting is off by default in many repos and organisations, and a workflow's \`permissions:\`
block cannot grant it. Until it is on, every sync will push its branch and reopen this issue rather
than failing the job.

<!-- $marker -->"
