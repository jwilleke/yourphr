# Semver Release

Cut a new semver release: bump `package.json` (and `config/app-default-config.json` + `CHANGELOG.md`) via ngdpbase's `src/utils/version.ts`, create an annotated git tag, push it, and create a GitHub release with auto-generated notes.

## Relationship to /session-commit

`/semver` is **release mechanics only** (Steps 1–9: gate → bump → baseline → tag → push → GitHub release → jimstest-first re-validate → `/othersites`). It does **NOT** update `docs/project_log.md`, comment on / close GitHub issues, or run `/check-todos` — that bookkeeping lives in `/session-commit` Steps 6–9.

- **"I did work, ship it"** → run **`/session-commit`**, not `/semver`. `/session-commit` commits the work, pre-flights jimstest, makes the semver decision and **invokes `/semver` internally** (Step 4), propagates, then logs + comments issues + freshens TODO. Running `/semver` yourself in this case skips the log/issue/TODO updates.
- **"Work is already committed & logged, just cut/consolidate a release"** → standalone `/semver` is correct. But it leaves a bookkeeping gap: after it finishes you must still add a project_log entry for the *release event itself* (version, baseline drift, `/othersites` results, any flakes) and comment/close any issues the release ships. `/semver` will not do this for you.

`/semver` also requires a clean tree on `master` (Step 1) — it never commits your feature work. Commit (or `/session-commit`) first.

## Usage

`/semver <bump>` — where `<bump>` is one of:

- `patch` — `0.2.0` → `0.2.1` (bug fixes, docs, chores; no new features, no breaking changes)
- `minor` — `0.2.0` → `0.3.0` (new features; for pre-1.0 also use this for breaking changes)
- `major` — `0.2.0` → `1.0.0` (breaking changes once the API is stable; rarely used pre-1.0)

If the user did not specify a bump type, ask them which one before proceeding.

## Steps

### Step 1: Verify the working tree is clean and on master

Run in parallel:

- `git status --porcelain` — must be empty. If not, stop and tell the user to commit or stash first.
- `git rev-parse --abbrev-ref HEAD` — must be `master`. If not, ask the user to confirm before proceeding.
- `git fetch origin && git rev-list --count HEAD..origin/master` — must be `0`. If the local branch is behind, stop and tell the user to pull first.

### Step 2: Determine current and next version

- Read `package.json` `version` field.
- Compute the next version from the requested bump (`patch` increments the third number, `minor` increments the second and zeros the third, `major` increments the first and zeros the rest).
- Show the user: `current → next` and confirm before continuing **only if** the bump is `major` or if there are no commits since the last tag (i.e., nothing to release). For `patch` / `minor` with new commits, proceed without prompting.

### Step 3: Summarize what's in the release

- Run `git log <last-tag>..HEAD --oneline` to list commits since the previous tag.
- If there are zero commits since the last tag, stop and tell the user there's nothing to release.

### Step 4: Build, then run the full test suite

A release that doesn't pass tests should not exist. Run tests **before** any version bump so nothing on disk has to be rolled back if a test fails.

Run sequentially:

- `npm run build` — compiles TypeScript. Required so both the test build and `dist/src/utils/version.js` (used in Step 5) are fresh.
- `npm test` — must pass (Vitest unit + integration).
- `npm run test:e2e` — must pass (Playwright). The dev server must be up; if it isn't, run `./server.sh restart` and wait for `http://localhost:3000` before invoking E2E.

If anything fails, **stop**. Fix the failures and start again from Step 1. The working tree is still clean at this point — nothing to roll back.

### Step 5: Bump the version with `version.ts`

ngdpbase ships its own version tool at `src/utils/version.ts` which keeps `package.json`, `config/app-default-config.json`, and `CHANGELOG.md` in lockstep. **Do not** edit those files by hand.

Run sequentially:

- `node dist/src/utils/version.js <bump>` — bumps all three files in one shot. Output looks like `Version updated: 3.3.6 → 3.3.7`.
- Stage the three updated files: `git add package.json config/app-default-config.json CHANGELOG.md`.
  - Stage `package-lock.json` too only if it actually changed (rare for version-only edits).

### Step 5a: Capture a performance baseline + diff vs previous (#611)

After the version bump (so the new `<VERSION>` is reflected in the filename) and before the release commit, capture a baseline snapshot **and** diff it against the most recent prior baseline in one shot:

- `npm run test:baseline:compare` — runs `scripts/baseline-profile.sh --compare`. Writes `docs/performance/baseline-v<VERSION>-<DATE>.md` (or `-r2.md` etc. if a same-day same-version baseline already exists), then appends a `## Drift vs <previous>` section to it and prints the same table to stdout.
- Stage the new file: `git add docs/performance/baseline-v<VERSION>-*.md`.

The plain `npm run test:baseline` is still available for non-release captures (just measure, no diff). Use `npm run test:baseline:cold` to also stop/start the server first (slower; only do this when a restart is already part of the plan).

The script auto-detects the previous baseline. If this is the first-ever baseline, the diff section is skipped and the script exits 0.

### Step 5b: Surface the perf diff to the user (and maybe stop)

The script flags regression candidates with `⚠️` and **exits non-zero** when any threshold trips. Default thresholds (override via env var if you have a reason):

- `BASELINE_MEM_DELTA_PCT=25` — memory % regression
- `BASELINE_RT_DELTA_PCT=50` — route % regression (must trip together with the ms threshold below)
- `BASELINE_RT_DELTA_MS=50` — route absolute regression (avoids 1ms-on-already-fast-route false positives)

**Default thresholds** — override via env var if needed:

- `BASELINE_MEM_DELTA_PCT=25` — memory % regression
- `BASELINE_RT_DELTA_PCT=50` — route % regression (must trip together with the ms threshold below)
- `BASELINE_RT_DELTA_MS=50` — route absolute regression (avoids 1ms-on-already-fast-route false positives)

Behavior on regression: the script exits 1 with the warning printed. Acknowledge the regression in your reply, surface it in the release report (Step 9), and ask the user whether to proceed before continuing to Step 6. **Don't auto-rollback** — measurement noise is real (cold-cache snapshots show 100ms+ outliers across the historical baseline series; see `docs/performance/`). User judgment required.

**No regressions** (script exits 0): just include the printed Drift table in the report and continue.

**First release** (no prior baseline): the script prints "no prior baseline to compare against" and exits 0 — proceed normally.

### Step 6: Commit, tag, and push

Run sequentially:

- `git commit -m "chore: release v<next>"` (with the standard `Co-Authored-By` trailer).
- `git tag -a v<next> -m "v<next>"` — keep the tag message short; the GitHub release will carry the detailed notes.
- `git push origin master` — push the commit first.
- `git push origin v<next>` — then the tag, so the release commit is reachable on the default branch.

### Step 7: Create the GitHub release (conditional)

**Auto-release rule:**

- **`minor` or `major`** — always create the GitHub release. New feature surface or breaking change deserves a visible release entry every time.
- **`patch`** — skip the GitHub release unless the user explicitly asked for one in this turn (or in an earlier turn of the same session). Patch chains shipped without releases can be consolidated later via the `/release` skill — see `.claude/commands/release.md`.
- **When in doubt or when the user asks** — create the release.

When creating:

- `gh release create v<next> --title "v<next>" --generate-notes --notes-start-tag v<previous>`
  - `--generate-notes` autogenerates from merged PRs and commits in the range.
  - `--notes-start-tag` makes the range explicit so notes don't accidentally span multiple releases.

When skipping (patch with no explicit request):

- Push the tag (Step 6 already did this) and report in Step 9 that the release entry was deferred. Mention that `/release` can publish it later if needed.

### Step 8: Update sister installs

**Step 8a — Re-validate jimstest on the release commit FIRST (mandatory, before any satellite).**

The Step 4 test gate ran on the **pre-release** commit. Step 5/6 then bumped the version and created the release commit *after* that gate, so jimstest's running server has NOT been validated on the final released code. jimstest is the source of truth and must never lag the satellites. Before invoking `/othersites`:

- `npm run build` (release commit is checked out) → `./server.sh stop && ./server.sh start` → `npm test` (unit must be GREEN) → `npm run test:e2e` if the release range touches any UI-affecting path (`views/**`, `public/**`, `src/plugins/**`, `addons/**`, `tests/e2e/**`; when unsure, run it).
- Only after jimstest is green on the **release commit** do you proceed to the satellites.

This is non-negotiable: never propagate a release to satellites while jimstest is still on pre-release code. See `feedback_jimstest_first` in memory.

**Step 8b — Propagate to the satellites.**

Sister ngdpbase installs (e.g., The Fairways, ve-geology) need to be told about the new release. Invoke the `/othersites` skill — defined in `.claude/commands/othersites.md`. It knows the list of installs and the update sequence (`git pull` → `./server.sh stop` → `npm run build` → `./server.sh start` → unit tests + E2E per site → file `[BUG]` issues for any failures). Because Step 8a already validated jimstest on the release commit, `/othersites` may run in satellite-only mode here (skip jimstest) — that skip is valid *only* because Step 8a was performed on the final code.

The current sites tracked there are:

- `/Volumes/hd2A/workspaces/github/fairways-base` (port 2121, "The Fairways")
- `/Volumes/hd2A/workspaces/github/ngdpbase-veg` (port 3333, "ve-geology")
- `/Volumes/hd2A/workspaces/github/ngdpbase` (port 3000, "jimstest" — the source of truth)
- `/Volumes/hd2/ngdp-temp-builds/` (additional builds; ports in their `.env` files)

If a site has uncommitted local diffs that block the pull (typically `package-lock.json` from a prior build, or the seed required-pages file from an auto-migration), the pattern that's worked across past releases is `git checkout -- <file>` for the known-identical-to-master files, then re-run the pull. Untracked working notes in `private/` and similar are fine to leave alone.

### Step 9: Report

Output to the user:

- Old version → new version
- Tag URL (from `gh release view v<next> --json url --jq .url`)
- Number of commits in this release (from Step 3)
- **Perf diff table** from Step 5b (re-included here for easy reference; if any regression candidate was flagged, repeat the warning)
- Whether `/othersites` propagation succeeded.

**Bookkeeping reminder (standalone `/semver` only):** `/semver` does not touch `docs/project_log.md`, GitHub issues, or `/check-todos`. If this was a standalone invocation (not driven by `/session-commit`), add a project_log entry for the release event (version, baseline drift, `/othersites` results + any flakes) and comment/close any issues the release ships — see [Relationship to /session-commit](#relationship-to-session-commit). When `/semver` was invoked from `/session-commit`, its Steps 6–9 cover this; do not duplicate.

## Rules

- Never tag if the working tree is dirty.
- Never tag a commit that hasn't been pushed.
- Never skip the test suite before tagging.
- Never skip the GitHub release — auto-generated notes are the whole point of cutting a tag.
- Use annotated tags (`-a`), never lightweight tags.
- Tag names are always prefixed with `v` (e.g., `v3.3.7`, not `3.3.7`).
- For pre-1.0 versions, treat breaking changes as `minor` bumps (the standard pre-1.0 convention).
- `CHANGELOG.md` is updated automatically by `version.ts`; do not edit it by hand for release entries. (Manual edits are fine for descriptive prose between releases, but the version-bump line itself is owned by the tool.)
- Do not bump versions through `npm version` — it skips `app-default-config.json` and `CHANGELOG.md`.
