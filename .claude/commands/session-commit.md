# Session Commit

Commit the session's work, refresh the priority mirror, journal the session, and update
related GitHub issues. The personal log is __never committed__.

## Steps

### Step 1: Gather context (run in parallel)

- `git status` — all changed files
- `git diff --stat` — scope of changes
- `git log --oneline -5` — match commit-message style
- `gh issue list --state open --limit 20` — related open issues

### Step 2: Commit the code

- Stage the relevant changed files (never `.claude/settings.local.json`, never anything under `private/`).
- Write a Conventional Commit message: `type(scope): description`.
- Commit.

### Step 3: Refresh `TODO.md` and commit it

- Regenerate `TODO.md` from the current GitHub issue labels (same banding as `/pstatus`:
  P0 / P1 / P2 / Deferred / Needs triage). The `▶ Resume here` pointer is owned by `/wrap`; no need
  to preserve it here. If `/pstatus` was just run, it is already current.
- Apply `needs-triage` to any open issue with no placement label (`P0` / `P1` / `P2` / `deferred` /
  `in-review`), exactly as `/pstatus` does. Two commands that regenerate the same file from the same
  labels must not disagree about what an unlabeled issue means.
- Follow `.markdownlint-cli2.jsonc`, the control file for markdown style — including for any bare
  URL that arrives inside an issue or PR title. `TODO.md` is generated, so a violation turns the lint
  job red on a file nobody hand-edited.
- Stage and commit `TODO.md` if it changed: `docs: refresh TODO from issue labels`.

### Step 4: Journal the session (local only — NOT committed)

Append an entry to `private/project_log.md` (gitignored), newest on top:

```text
## yyyy-MM-dd-NN

- Agent: Claude
- Subject: <brief description of the session>
- Current issue: <#123 or none>
- Work done:
  - <task>
- Commits: <short hash(es)>
- Files modified:
  - <file>
```

Use today's date; `NN` increments per same-day entry starting at `01`.

### Step 5: Update related GitHub issues

For each related open issue:

- Comment summarizing what was done, referencing the commit hash(es).
- If the work fully resolves it, say so but do __not__ close it — let the operator decide
  (consider adding `in-review`).
- Use `gh issue comment <number> --body "<comment>"`.
- __When an issue or PR is closed, remove `in-review` as part of closing it__ —
  `gh issue edit <n> --remove-label in-review`, before or with the close. A closed item that keeps
  the label makes it stop meaning "awaiting a decision", and the queue it drives stops being
  trustworthy.

### Step 6: Push

- Ask the operator whether to push to remote.

## Notes

- `private/project_log.md` is gitignored and personal — it is appended locally only.
- If `docs/project_log.md` still exists (pre-kit), it should have been migrated to
  `private/project_log.md` by `install-kit.sh`.
- After committing, the natural next step is `/pstatus`.

## Repo-specific additions

This file is __kit-managed and overwritten wholesale__ on every `install-kit.sh` run — anything
you add here is lost at the next sync, silently until the installer started warning about it.

If this repo needs something extra from `/session-commit` — a package manager the kit does not name, a
scanner only this repo has, a path only this repo uses — put it in
`.claude/commands/session-commit.local.md`. The kit never writes, reads, or deletes that file.

__Read it, if it exists, and treat its contents as part of this command.__ A rule that is generic
does not belong there: raise it upstream in
[mjs-project-template](https://github.com/jwilleke/mjs-project-template) so every repo gets it.
