# /wrap — close the session safely

End-of-session ritual. Run it **last**, before shutting down VS Code. It makes sure every change is
committed, refreshes the "Resume here" pointer at the top of the log, and reports whether it is safe
to close.

## Steps

### Step 1: Survey everything outstanding

Git state:

- `git status -sb` — uncommitted changes, untracked files, branch + ahead/behind
- `git stash list` — forgotten stashes
- `git log --oneline @{u}..HEAD` — unpushed commits

In-flight work that a shutdown would orphan (note status of each, anything of significance):

- **Workflows / background agents** still running this session (e.g. `/workflows`, background tasks) — capture what each is doing and whether it finished.
- **Running processes** started this session — dev servers, watchers, background shells, tunnels.
- **CI in progress** — `gh run list --limit 5` (anything `in_progress`/`queued`).
- **Open PRs awaiting action** — `gh pr list` (review/merge state).
- **Scheduled tasks / routines** that will fire (`/schedule` list, cron).

### Step 2: Commit outstanding work

- If the working tree has changes other than intentionally-local files
  (`.claude/settings.local.json`, anything under `private/`), run the `/session-commit` flow to
  commit them (code + `TODO.md` + a journal entry). Otherwise note "nothing to commit".

### Step 3: Refresh the "Resume here" pointer

Overwrite the marker-delimited block at the **top** of `TODO.md` (above the generated priority
bands) so the next session — on any machine, since `TODO.md` is committed — knows exactly where to
pick up:

```text
<!-- RESUME:START -->
## ▶ Resume here — yyyy-MM-dd

- Last worked on: one-line summary
- Branch / state: BRANCH, clean | N unpushed | N stashes
- Running / in-flight: workflows, background agents, dev servers, in-progress CI — or "none"
- Parked / half-done: uncommitted experiments, partial work — or "none"
- Next steps:
  - the next concrete action
- Blockers / significant notes: or "none"
<!-- RESUME:END -->
```

Insert the block right after the `# TODO` title (the markers will usually be absent, since `/status`
regenerated a bands-only `TODO.md` during the session; replace the block if it is present). This
reflects only the latest handoff — `/context` reads it next session, then the first `/status` clears
it again.

### Step 4: Commit the refreshed pointer & push (ask)

- Stage and commit `TODO.md` if the Resume block changed (`docs: refresh resume pointer`).
- If there are unpushed commits, ask the operator whether to push before shutdown.

### Step 5: Shutdown-readiness verdict

Report one clear verdict:

- ✅ **Safe to close** — working tree clean (or only intentional local files), commits pushed
  (or explicitly held), nothing running, resume pointer written.
- ⚠️ **Attention** — list anything a shutdown would interrupt or that would be forgotten:
  still-running workflows / background agents / dev servers, in-progress CI, untracked files
  not committed, stashes, unpushed commits held locally by choice.

## Notes

- `/wrap` is the close bookend to `/context` (open) and complements `/session-commit` (per-chunk).
- `/context` and `/status` read the `▶ Resume here` block at the top of `TODO.md` first to restore
  continuity. The dated session history stays in `private/project_log.md`.
