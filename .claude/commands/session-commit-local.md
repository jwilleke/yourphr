---
description: Review the working tree and commit this session's work as focused conventional commits, then push
argument-hint: "[optional scope/note, e.g. 'ci fixes' — or 'no-push' to commit only]"
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob
---

# /commit-session

Commit the work from this session cleanly and push it. Default flow matches how this repo is run: **focused, conventional commits straight to `main`** on `origin` (`jwilleke/yourphr`).

`$ARGUMENTS` may carry a scope hint or flags:

- `no-push` → commit but do not push.
- `branch` → create a topic branch instead of committing to `main`.
- anything else → treat as a scope/summary hint for the commit message.

## Steps

1. **Survey** — `git status --short` and `git diff --stat`, then `git diff` (and `git diff --staged`) to understand every change. Don't commit blind.

2. **Sanity checks before committing**
   - Confirm nothing sensitive is staged (tokens, keys, real patient data, `config.dev.yaml`, `*.db`). `private-jims/` and `.claude/` are gitignored — verify they aren't force-added.
   - If tests are relevant to the change and quick to run, run them (`make test-backend` / a targeted `ng test --include=...`) and only commit if they pass. Note in your summary if you skipped this and why.
   - Never stage with `git add -A` blindly — add the specific files for each logical change.

3. **Group into focused commits** — one logical change per commit. Don't bundle an unrelated docs tweak with a bugfix. Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`, `ci:`. Scope when it helps (`fix(ci): …`, `fix(fhir): …`).

4. **Commit message body** — explain *why*, not just *what*. For non-trivial changes, list the root cause and what was verified. End every commit message with the trailer:

   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

5. **Branch policy**
   - Default: commit on the current branch (`main`) — this is the established flow and pushing to `main` is what runs CI.
   - If `$ARGUMENTS` contains `branch`, or the change is risky/large, create `fix/<slug>` or `feat/<slug>` first and open a PR with `gh pr create` using the appropriate issue template context.

6. **Push** — unless `no-push` was passed: `git push origin <branch>`. Then confirm CI kicked off (`gh run list --repo jwilleke/yourphr --limit 5`) and report the run IDs/status.

7. **Close the loop on issues** — if this session made or confirmed a decision tied to a GitHub issue, post a short comment summarizing the decision and rationale (global rule: decisions go on the issue, not just in chat). If the work fixes an issue, reference it in the commit (`Fixes #N`) or note it for the PR. And close it.

8. Run /check-todos
Run /check-todos

## Project Log

Update private-jims/project_log.md with details as shown:

Rules for the log entry:

- Newest entry at top
- Use today's date for yyyy-MM-dd
- Use NN as a zero-padded incrementing number if there are multiple entries for the same date (start at 01)
- For Agent, use the name of the AI agent (e.g., "Claude")
- For Current Issue, reference any GitHub issue numbers as #123 format
- For Commits, use the short hash(es) from git log
- For Files Modified, list every file that was changed in this session

## yyyy-MM-dd-NN

- Agent: [Claude/Gemini/Other]
- Subject: [Brief description of the session's work]
- Current Issue: [GitHub issue number if applicable, or "none"]
- Work Done:
  - [task 1]
  - [task 2]
- Commits: [commit hash(es) from this session]
- Files Modified:
  - [list each modified file]

// ## Entries go below here
