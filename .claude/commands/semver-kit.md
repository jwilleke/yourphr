# Semver Release

Cut a new semver release: bump `package.json`, create an annotated git tag, push it, and create a GitHub release with auto-generated notes.

## Usage

`/semver <bump>` — where `<bump>` is one of:

- `patch` — `0.2.0` → `0.2.1` (bug fixes, docs, chores; no new features, no breaking changes)
- `minor` — `0.2.0` → `0.3.0` (new features; for pre-1.0 also use this for breaking changes)
- `major` — `0.2.0` → `1.0.0` (breaking changes once the API is stable; rarely used pre-1.0)

If the user did not specify a bump type, ask them which one before proceeding.

__Standing authorization (see AGENTS.md → Release Policy):__ cut the release on any `minor` or `major` bump, or whenever the maintainer asks — without prompting for confirmation. Do not ask "should I tag/release?" for these. The only reasons to stop are the hard safety gates below (dirty tree, behind remote) or nothing to release (zero commits since the last tag). Patch-only chains may be deferred or consolidated.

__Versioning model:__ between releases the live version is `git describe` output — `vX.Y.Z-N-g<sha>` (last tag, commits since it, abbreviated SHA). A formal cut graduates that to a clean annotated `vX.Y.Z` tag. A large `N` ("80 commits and no release") is expected, not a defect.

## Steps

### Step 1: Verify the working tree is clean and on master

Run in parallel:

- `git status --porcelain` — must be empty. If not, stop and tell the user to commit or stash first.
- `git rev-parse --abbrev-ref HEAD` — must be `master`. If not, ask the user to confirm before proceeding.
- `git fetch origin && git rev-list --count HEAD..origin/master` — must be `0`. If the local branch is behind, stop and tell the user to pull first.

### Step 2: Determine current and next version

- Read `package.json` `version` field.
- Compute the next version from the requested bump (`patch` increments the third number, `minor` increments the second and zeros the third, `major` increments the first and zeros the rest).
- Show the user: `current → next`. Then proceed without asking for confirmation — `minor` and `major` bumps carry standing authorization, and `patch` does too once requested. The __only__ stop condition here is no commits since the last tag (nothing to release), handled in Step 3.

### Step 3: Summarize what's in the release

- Run `git log <last-tag>..HEAD --oneline` to list commits since the previous tag.
- If there are zero commits since the last tag, stop and tell the user there's nothing to release.

### Step 4: Bump the version

- Run `node utility/set-version.mjs <next>` — writes the new version into `package.json` __and__
  `package-lock.json`, and nothing else.
- Confirm the diff is version-only: `git diff --stat` should show 1 changed line in `package.json`
  and 2 in `package-lock.json`.
- Stage both files.

__The lockfile requirement, stated rather than assumed.__ `package-lock.json` carries the project
version in __two__ places — the top-level `version` and `packages[""].version` — and npm rewrites
both on the next `npm install`. Bump only `package.json` and every release ships a lockfile one
version behind, so every checkout shows a two-line lockfile diff after any build. Those get
discarded by hand at each release, which trains a reflexive `git checkout -- package-lock.json`
that will eventually throw away a *real* lockfile change. __If you replace this step with your own
bump tool, that tool must write both fields.__ This is how the step gets silently lost in a fork:
it reads as boilerplate attached to the manual edit, so it leaves with it.

__Why not `npm install --package-lock-only`.__ That re-resolves the dependency tree against the
registry and can bump transitive resolutions that satisfy existing ranges — unrelated to the
release, and badly timed: the test gate in Step 1–3 already passed against the *old* resolution, so
the lockfile that ships is not the one that was tested. Usually a no-op; when it is not, the change
is invisible inside a large diff and lands unreviewed. `utility/set-version.mjs` never re-resolves.

### Step 5: Commit, tag, and push

Run sequentially:

- `git commit -m "chore: release v<next>"` (with the standard `Co-Authored-By` trailer).
- `git tag -a v<next> -m "v<next>"` — keep the tag message short; the GitHub release will carry the detailed notes.
- `git push origin master` — push the commit first.
- `git push origin v<next>` — then the tag, so the release commit is reachable on the default branch.

### Step 6: Create the GitHub release

- `gh release create v<next> --title "v<next>" --generate-notes --notes-start-tag v<previous>`
  - `--generate-notes` autogenerates from merged PRs and commits in the range.
  - `--notes-start-tag` makes the range explicit so notes don't accidentally span multiple releases.

### Step 7: Report

Output to the user:

- Old version → new version
- Tag URL (from `gh release view v<next> --json url --jq .url`)
- Number of commits in this release (from Step 3)

## Rules

- Never re-prompt for confirmation on a `minor` or `major` bump (or any explicit request) — that authorization is standing. The hard safety gates (clean tree, on the default branch, not behind remote, commits exist to release) still apply and are the only legitimate stops.
- Never tag if the working tree is dirty.
- Never tag a commit that hasn't been pushed.
- Never skip the GitHub release — auto-generated notes are the whole point of cutting a tag for this repo.
- Use annotated tags (`-a`), never lightweight tags.
- Tag names are always prefixed with `v` (e.g., `v0.2.1`, not `0.2.1`).
- For pre-1.0 versions, treat breaking changes as `minor` bumps (the standard pre-1.0 convention).
- Do not edit `CHANGELOG.md` unless the project already has one being actively maintained — release notes generated by `gh release create --generate-notes` are the system of record.
