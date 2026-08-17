# /wrap — close the session safely

End-of-session ritual. Run it __last__, before shutting down VS Code. It makes sure every change is
committed, refreshes the "Resume here" pointer at the top of the log, and reports whether it is safe
to close.

## Steps

### Step 1: Survey everything outstanding

Git state:

- `git status -sb` — uncommitted changes, untracked files, branch + ahead/behind
- `git stash list` — forgotten stashes
- `git log --oneline @{u}..HEAD` — unpushed commits

In-flight work that a shutdown would orphan (note status of each, anything of significance):

- __Workflows / background agents__ still running this session (e.g. `/workflows`, background tasks) — capture what each is doing and whether it finished.
- __Running processes__ started this session — dev servers, watchers, background shells, tunnels.
- __CI in progress__ — `gh run list --limit 5` (anything `in_progress`/`queued`).
- __Open PRs awaiting action__ — `gh pr list` (review/merge state).
- __Scheduled tasks / routines__ that will fire (`/schedule` list, cron).

### Step 2: Commit outstanding work

- If the working tree has changes other than intentionally-local files
  (`.claude/settings.local.json`, anything under `private/`), run the `/session-commit` flow to
  commit them (code + `TODO.md` + a journal entry). Otherwise note "nothing to commit".

### Step 3: Refresh the "Resume here" pointer

Overwrite the marker-delimited block at the __top__ of `TODO.md` (above the generated priority
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

Insert the block right after the `# TODO` title (the markers will usually be absent, since `/pstatus`
regenerated a bands-only `TODO.md` during the session; replace the block if it is present). This
reflects only the latest handoff — `/context` reads it next session, then the first `/pstatus` clears
it again.

### Step 4: Commit the refreshed pointer & push (ask)

- Stage and commit `TODO.md` if the Resume block changed (`docs: refresh resume pointer`).
- If there are unpushed commits, ask the operator whether to push before shutdown.

### Step 5: Shutdown-readiness verdict

Report one clear verdict:

- ✅ __Safe to close__ — working tree clean (or only intentional local files), commits pushed
  (or explicitly held), nothing running, resume pointer written.
- ⚠️ __Attention__ — list anything a shutdown would interrupt or that would be forgotten:
  still-running workflows / background agents / dev servers, in-progress CI, untracked files
  not committed, stashes, unpushed commits held locally by choice.

## Notes

- `/wrap` is the close bookend to `/context` (open) and complements `/session-commit` (per-chunk).
- `/context` reads the `▶ Resume here` block at the top of `TODO.md` first to restore continuity.
  `/pstatus` does __not__ read it — it removes the block when it regenerates the bands. So the
  block survives exactly one hop: `/wrap` writes it, the next session's `/context` reads it, the
  first `/pstatus` of that session clears it. Open a session with `/context`, not `/pstatus`, or
  the pointer is discarded unread. The dated session history stays in `private/project_log.md`.

## Repo-specific additions

This file is __kit-managed and overwritten wholesale__ on every `install-kit.sh` run — anything
you add here is lost at the next sync, silently until the installer started warning about it.

If this repo needs something extra from `/wrap` — a package manager the kit does not name, a
scanner only this repo has, a path only this repo uses — put it in
`.claude/commands/wrap.local.md`. The kit never writes, reads, or deletes that file.

__Read it, if it exists, and treat its contents as part of this command.__ A rule that is generic
does not belong there: raise it upstream in
[mjs-project-template](https://github.com/jwilleke/mjs-project-template) so every repo gets it.
