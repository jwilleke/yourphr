# Release

Create (or backfill) a GitHub Release for an existing git tag, without bumping the version.

Use this when:

- A patch chain shipped without releases (because `/semver patch` skips the release by default — see `.claude/commands/semver.md` Step 7) and you want to publish one consolidated release for the head, OR
- The user explicitly asks "make a release" / "publish a release" / "cut the release for v3.x.y" on an already-tagged commit, OR
- A `/semver` invocation was interrupted after Step 6 (tag pushed) but before Step 7 (GitHub release created), and you want to finish the release without rolling anything back.

This skill **never bumps versions**, **never creates tags**, and **never touches the working tree**. It only calls `gh release create`.

## Usage

`/release [version]` — where `[version]` is optional:

- Omitted → release the most recent local tag (i.e. `git tag --sort=-creatordate | head -1`) if it doesn't already have a GitHub release.
- `v3.11.2` or `3.11.2` → release that specific tag (with or without the `v` prefix; the script normalizes).
- `--all-missing` → backfill GitHub releases for every local tag that doesn't have one yet, walking forward in chronological order. Use sparingly — this can create many release entries at once.

## Steps

### Step 1: Determine the target tag(s)

- Run `git tag --sort=-creatordate | head -10` to see recent tags.
- Run `gh release list --limit 20 --json tagName --jq '.[].tagName'` to see which tags already have releases.
- Compute the diff: tags that exist locally but have no release.
- If the user specified a version, validate it's a real tag (`git rev-parse <version>` succeeds) and not already released.
- If `--all-missing`, return the full list sorted oldest-first so releases land in chronological order on the GitHub releases page.

If the target tag isn't pushed to `origin` yet, push it first (`git push origin <tag>`) before creating the release.

### Step 2: Find the previous release (for notes range)

- For each target tag, the previous release is the most recent published GitHub release **older than** that tag's creation time.
- `gh release list --limit 20 --json tagName,createdAt --jq 'sort_by(.createdAt) | reverse'` then pick the first one with `createdAt < <target-tag-time>`.
- Use this as `--notes-start-tag` so auto-generated notes don't accidentally span releases that exist already.

### Step 3: Build the release notes

Two strategies, in priority order:

1. **Prefer auto-generated** — `gh release create <tag> --generate-notes --notes-start-tag <previous>` works well when the range has merged PRs with descriptive titles. This is the default.

2. **Hand-curated when consolidating** — when releasing a single tag that consolidates a multi-tag patch chain (e.g. one release covering v3.10.4 → v3.11.2), draft notes that:
   - Lead with headline outcomes grouped by issue (`#658 Contact endpoint`, etc.) rather than per-version
   - Include a per-version detail table (version | type | one-line headline)
   - Call out known limitations / open follow-ups explicitly (filed bugs that didn't land in this release)
   - Cite test count delta and any regressions / regressions-avoided versus the previous release

Write the curated body to a temp file (`.release-notes.tmp` in repo root, gitignored) and pass via `--notes-file`. Delete the temp file after `gh release create` returns.

### Step 4: Create the release

- `gh release create <tag> --title "<tag> — <one-line summary>" --notes-file <file>` (curated path), OR
- `gh release create <tag> --title "<tag>" --generate-notes --notes-start-tag <previous>` (auto path)

**Latest-flag gotcha:** GitHub picks the "Latest" release by **most-recent publish time**, not by semver. Backfilling an older tag (e.g. publishing v3.10.3 today when v3.11.2 is already out) will take the Latest crown away from the head release. After backfilling any release that isn't itself the current head, restore Latest:

```bash
gh release edit <current-head-tag> --latest
```

Verify with `gh release list --limit 3` — the head should show "Latest" in the second column.

### Step 5: Verify and report

- `gh release view <tag> --json name,tagName,isPrerelease,isDraft,publishedAt,url`
- `gh release list --limit 3` — confirm Latest moved as expected
- Report to the user: title, URL, whether marked Latest

## Rules

- Never bump versions in this skill — that's `/semver`'s job.
- Never create tags in this skill — they must already exist locally and on origin.
- Never modify the working tree (no commits, no edits to `CHANGELOG.md` / `package.json` / etc.).
- For `--all-missing`, walk tags chronologically (oldest first) so the GitHub releases page shows them in the right order.
- For consolidation releases (one release covering many tags), explicitly state the consolidation in the title and the per-version detail table — operators looking at the release shouldn't have to reverse-engineer which tags it covers.
- Clean up `.release-notes.tmp` even on error paths.
