# Warp — session parking-lot wrap-up

End-of-session handoff: leave clean breadcrumbs so the next session can pick up immediately with full context. Lighter than `/session-commit` — no code work, just state capture and push.

## When to use

Run `/warp` when wrapping a session that has open threads that were **discussed but not completed**, or where context needs to be parked so the next session doesn't have to re-derive it. For sessions where all work is committed and closed, `/session-commit` is sufficient; `/warp` is the follow-on when there's still a parking lot.

## Phase 1 — Inventory open threads

For each repo with active work this session, gather:

- `gh issue list --repo <owner>/<repo> --state open --limit 50` for any repo touched this session (not just the standard three)
- `git -C ~/thishost status --porcelain`
- Read `~/thishost/TODO.md`

Identify:

- **In-flight:** issues where work started but isn't merged/closed
- **Blocked:** issues waiting on a dependency (name it explicitly)
- **Expiring:** anything with a stated deadline or soak window that closes soon
- **Next-session starters:** the most logical first issue to pick up next time

## Phase 2 — Post GitHub status comments

For every **in-flight** or **blocked** issue touched this session, post a comment with:

- What was done / what state it's in
- What the specific next action is
- What it's blocked on (if anything)
- Any commands or file paths the next session will need

Keep comments terse — they're for the operator, not a public audience.

## Phase 3 — Session log entry

Append a session entry to `~/thishost/docs/project_log.md` using the standard format. Mark it clearly as a warp/handoff entry in the Subject line. Include a "Parked threads" sub-list under Work Done for anything left open.

Run `npx --yes markdownlint-cli docs/project_log.md` before committing.

## Phase 4 — Update TODO.md

Reconcile `TODO.md` against the live trackers (same as `/check-todos` Phase 1–5). Pay special attention to:

- Any new issues filed this session
- Any repos not currently in the standard three that now have tracked work
- Any items with imminent deadlines that need a flag in the summary line

## Phase 5 — Commit and push

Stage `docs/project_log.md`, `TODO.md`, and any updated command files. Commit with `log: warp yyyy-MM-dd-## — <one-line subject>`. Ask before pushing to any remote.

## Notes

- Never commit code changes here — that belongs in `/session-commit`. This command only touches docs and `TODO.md`.
- If a new repo came into scope this session (e.g. `yourphr`), decide whether it belongs in the standard `/check-todos` coverage and update `check-todos.md` if so.
- Time-sensitive items (soak windows, freeze dates, deployment windows) should be called out explicitly in the session log entry, not just listed in TODO.
