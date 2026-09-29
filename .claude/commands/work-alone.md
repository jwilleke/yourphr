# /work-alone — progress open issues while the operator is away

For a stretch when the operator is not at the keyboard. Work the repo's existing open issues in
priority order, do only what can be undone, and leave one log the operator can read on return to see
what needs them, what was decided for them, and what looked wrong.

It does __not__ invent work. When nothing is actionable, it writes that down and stops.

## Arguments

- `/work-alone` — defaults: up to 3 issues, every open issue in scope.
- `/work-alone max=<n>` — cap on issues progressed this run.
- `/work-alone #12 #15` — only these issues.
- `/work-alone label=<name>` — only issues carrying this label.

A routine that invokes this command passes the same arguments. There is no path argument: the log is
always `private/agent-work-alone.md` in the repo being worked, so every repo keeps it in the same
place.

## The log — `private/agent-work-alone.md`

One file per repo, never committed (`private/` is gitignored), created by this command the first time
it runs there. If it is absent, create it with exactly this skeleton:

```markdown
# Agent work-alone log

What agents did while the operator was away. Newest session first. Every session carries all four
sections, with *(none)* where there is nothing to say.

<!-- SESSIONS:START -->
<!-- SESSIONS:END -->
```

Each run adds __one__ session block directly under `<!-- SESSIONS:START -->`, so the newest is on
top. Earlier blocks are never rewritten, with one exception: an item the operator has answered may
be marked `✅ answered <yyyy-MM-dd>`. The session block:

```markdown
## Session yyyy-MM-dd HH:mm — <agent / model>

Scope: <arguments, or "default"> · Issues progressed: <n> · Ended: <queue empty | cap reached | all remaining Stuck>

### Stuck (needs the operator)

- [#<n>](<issue url>) — <the one question the operator must answer>. Recommend: <your answer and why>. Blocking: <what waits on it>.

### Decisions made without the operator

- [#<n>](<issue url>) — <what was decided>. Why: <reason>. Undo: <how to reverse it>.

### Other abnormalities observed

- <what was unexpected — failing CI, a flaky test, a stale branch, data that looks wrong, a tool that misbehaved>. Where: <file, run, or URL>.

### New issues filed

- [#<n>](<issue url>) — <title>. Found while: <what you were doing>.

### Progressed

- [#<n>](<issue url>) — <what moved>: <branch / draft PR / comment link>.
```

The first four sections are required in every block, even when empty. __Progressed__ is last because
it is the least urgent to a returning operator. Keep bullets to one or two lines and link rather than
paste — no diffs, no logs, no stack traces.

## Steps

### Step 1: Read before acting

- `git fetch` and `git status -sb` — never assume the local checkout is current.
- Read `AGENTS.md`, the `▶ Resume here` block in `TODO.md` if present, and the last entries of
  `private/project_log.md`.
- Read `private/agent-work-alone.md`. Every __Stuck__ item not yet marked answered is still parked.
  Every issue a prior session progressed has state you must pick up from, not redo.
- Read `.claude/commands/work-alone.local.md` if it exists (see the end of this file).

### Step 2: Pick the queue

From `gh issue list --state open --limit 100 --json number,title,labels,assignees,updatedAt`, filtered
by the arguments, order by:

1. Issues that block other open issues.
2. `P0`, then `P1`, then `P2`. Security first within a band.
3. Assigned to the operator, then the rest.
4. Oldest `updatedAt` first.

Skip:

- `deferred` and `in-review` — the operator has already placed them.
- Epics — work their child issues, not the container.
- Issues already Stuck in the log, __unless__ you can make reversible progress without the parked
  answer. If you can, say so under the existing Stuck item rather than filing a new one.
- Issues with an open PR that already addresses them.

Take the first `max` (default 3). If the queue is empty, go straight to Step 5 and record
`Ended: queue empty`. __Do not__ fill an empty queue with refactors, dependency bumps, lint sweeps, or
speculative issues.

### Step 3: Work each issue — reversible only

Read the whole issue, comments included; a late comment often overrides the body. Then:

__Proceed__ without asking — the work can be undone by deleting a branch or a comment:

- research, reading code, reproducing a bug
- a feature branch with commits, pushed
- tests, docs, and code on that branch
- a __draft__ PR that closes or refs the issue
- a comment on the issue recording findings or progress, stamped `work-alone <yyyy-MM-dd HH:mm>`
- a new issue for a concrete defect found while working, filed with the repo's issue template after
  searching for an existing one

__Stop and record under Stuck__ — any of these, whatever the arguments say:

- merging, approving, closing, or marking a PR ready for review
- pushing to the default branch, force-pushing, rewriting history, deleting a branch you did not
  create
- releasing, tagging, publishing, deploying
- sending anything outside the repo — email, chat, another service's API
- spending money or quota beyond ordinary CI
- changing security posture, credentials, permissions, or repo settings
- a product or design choice the issue leaves open, where two reasonable readings lead to different
  work
- anything irreversible, or that you are not sure is reversible

A standing permission counts only when it is written down — in the issue, `AGENTS.md`, or
`work-alone.local.md`. Absent that, there is none. When you are unsure, it goes under Stuck with a
crisp question and a recommendation — a clear question costs the operator seconds, a wrong guess
costs them an unwind.

A choice you did make that the operator might have made differently goes under __Decisions__, with
how to undo it. A choice nobody would question — a variable name, the order of two tests — is not a
decision; leave it out.

### Step 4: Watch for abnormalities

Anything that surprised you goes under __Other abnormalities__, even when unrelated to the issue:
red CI on the default branch, a test that passes then fails, a lockfile that does not match
`package.json`, a file that should be ignored but is tracked, an issue whose labels contradict its
text. Record it; do not fix it unless it is itself in the queue.

### Step 5: Write the session block

Add the block to `private/agent-work-alone.md` (create the file first if needed). Before adding a
Stuck item, check the earlier blocks for the same issue: when it is already there and still
unanswered, add a line under the existing item instead of a duplicate. The same goes for New issues
— search before filing so two sessions never file the same defect.

### Step 6: Report and stop

Print the session block. Do not commit `private/`; do not run `/wrap`. If the run left branches or
draft PRs, list them. Stop — the operator decides what happens next.

## Notes

- One owner per issue: if a prior session's branch or draft PR for an issue exists, continue on it
  rather than opening a second.
- `/pstatus` does not read this log, and `TODO.md` does not carry it. The log is for the operator's
  return; the issues and PRs are the durable record.

## Repo-specific additions

This file is __kit-managed and overwritten wholesale__ on every `install-kit.sh` run — anything
you add here is lost at the next sync, silently until the installer started warning about it.

If this repo needs something extra from `/work-alone` — a standing permission, a label to scope by,
a check only this repo has — put it in `.claude/commands/work-alone.local.md`. The kit never
writes, reads, or deletes that file.

__Read it, if it exists, and treat its contents as part of this command.__ A rule that is generic
does not belong there: raise it upstream in
[mjs-project-template](https://github.com/jwilleke/mjs-project-template) so every repo gets it.
