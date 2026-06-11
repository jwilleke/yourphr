# Session Commit

Commit the session's work, refresh the priority mirror, journal the session, and update
related GitHub issues. The personal log is **never committed**.

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

- Regenerate `TODO.md` from the current GitHub issue labels (same banding as `/status`:
  P0 / P1 / P2 / Deferred / Needs triage). The `▶ Resume here` pointer is owned by `/wrap`; no need
  to preserve it here. If `/status` was just run, it is already current.
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
- If the work fully resolves it, say so but do **not** close it — let the operator decide
  (consider adding `in-review`).
- Use `gh issue comment <number> --body "<comment>"`.

### Step 6: Push

- Ask the operator whether to push to remote.

## Notes

- `private/project_log.md` is gitignored and personal — it is appended locally only.
- If `docs/project_log.md` still exists (pre-kit), it should have been migrated to
  `private/project_log.md` by `install-kit.sh`.
- After committing, the natural next step is `/status`.
