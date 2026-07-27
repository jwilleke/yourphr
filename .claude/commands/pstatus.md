# /pstatus — ranked briefing & next step

A read-and-reconcile command. Run it **often** — ideally right before `/session-commit`.
It surfaces security first, ranks open work by priority, regenerates `TODO.md`, and
recommends what to do next. It does not start work.

## Scope

- `/pstatus` — the current repo (default).
- `/pstatus --all` — portfolio sweep across every active repo (P0 / security everywhere).

## Steps (single repo)

### Step 1: Gather (run in parallel, read-only)

- Security signals (quote the URL — an unquoted `?` is glob-expanded by zsh and the call silently fails with `no matches found`, which reads as a false "clean"):
  - `gh api "/repos/{owner}/{repo}/dependabot/alerts?state=open"`
  - `gh api "/repos/{owner}/{repo}/code-scanning/alerts?state=open"` (ignore a 404 — feature off)
  - any other scanner signal available (e.g. GitGuardian)
- `gh issue list --state open --limit 100 --json number,title,labels`
- `gh pr list --state open --limit 50 --json number,title,isDraft,mergeStateStatus,createdAt,labels,body,closingIssuesReferences`
  — `gh issue list` does **not** return PRs, so without this they are invisible to every band
  below. A merge-ready security PR can sit open across repeated `/pstatus` runs and never be
  mentioned once. `closingIssuesReferences` and `body` feed the PR ↔ issue linkage in Step 4.
- `git log --oneline -5`
- Read the last entries of `private/project_log.md` for session continuity.

### Step 2: Bridge scanner alerts → issues (idempotent)

For each open Dependabot / code-scanning / GitGuardian alert:

- Look for an existing tracking issue (search issue bodies for the marker
  `scanner-alert:<source>:<id>`).
- If none exists, create one:
  - Title: `[security] <package or rule> — <short summary>`
  - Body: the alert detail plus the marker line `scanner-alert:<source>:<id>`
  - Labels: `security` + a **graded** priority — critical/high → `P0`, medium → `P1`, low → `P2`
- Never create a duplicate for an alert that already has a tracking issue.

### Step 3: Triage gate

- Any open issue with **no** placement label (`P0` / `P1` / `P2` / `deferred` / `in-review`) gets
  `needs-triage` so it shows up as awaiting a decision rather than being silently mis-ranked. An
  `in-review` issue is already placed (it lands in the In review band) and is never flagged.

### Step 4: Rank and regenerate `TODO.md`

Overwrite `TODO.md` with the open issues grouped into bands.

**Remove the `▶ Resume here` block, including its `RESUME:START` / `RESUME:END` markers.** The
pointer is written by `/wrap` at session end and read by `/context` at session open; by the time
`/pstatus` runs you have already resumed, so it has served its purpose. The output of this step is a
bands-only `TODO.md` — that is intended, not a loss. `/pstatus` never reads the block and never
preserves it.

The bands, in this order:

- `🔴 P0 — Security & Critical` (list `security` / vulnerability issues first)
- `🟠 P1`
- `🟡 P2`
- `🔵 In review` (issues labeled `in-review` — work complete and pushed, awaiting the operator's
  decision to close; takes precedence over an issue's priority band so it surfaces as "ready for your call")
- `⏸ Deferred`
- `❓ Needs triage` (count + titles)
- `🔀 Open PRs` — every open pull request, newest first. Mark each `draft`, `ready`, or
  `conflicted` from `isDraft` / `mergeStateStatus`, and flag any open more than 7 days as stale.
  Dependency-bump PRs (Dependabot / Renovate) belong here too: they are frequently
  security-relevant and are exactly the kind of thing that goes unnoticed, because the
  corresponding scanner alert often looks *already tracked* by an unrelated issue.

**One issue per line — never bundle.** Each issue gets its OWN bullet, starting with a full clickable
GitHub link. No grouping headers that pack several refs onto one bullet, no comma-separated runs of
issues, no bare `#<num>`. Each line:

`- [#<num>](https://github.com/{owner}/{repo}/issues/<num>) — <title>`

PRs use the same one-per-line rule with the `/pull/` path, and **must name their related issues**:

`- [#<num>](https://github.com/{owner}/{repo}/pull/<num>) — <title> *(ready | draft | conflicted)* — closes [#<n>](…/issues/<n>)`

#### Resolving a PR's related issues

A PR shown without its issue context reads as unrelated housekeeping, so resolve the link for every
PR in the band. In order:

1. **Declared** — `closingIssuesReferences` from Step 1. These are the issues GitHub will
   auto-close on merge; render them as `closes #<n>`.
2. **Mentioned** — any `#<n>` in the PR body that is not a closing reference; render as `refs #<n>`.
3. **Inferred** — for a dependency-bump PR with neither, match the package name against open
   `security` issue titles and bodies (including the `scanner-alert:` markers from Step 2). A
   Dependabot PR bumping package `X` and a tracking issue for an advisory in `X` are the same work
   arriving from two directions. Render as `likely #<n>` — never as `closes`, since it is a guess.

If none of the three resolve, write `no linked issue` explicitly rather than leaving the line bare.
A silent absence is indistinguishable from "not checked".

Cross-reference both ways: an issue whose fix is already sitting in an open PR is **not** actually
open work. Annotate it in its own priority band as `— PR open: [#<pr>](…/pull/<pr>)` so the ranking
does not recommend starting something that is already written.

Where a PR turns out to be redundant — the change is already on the default branch, or a tracking
issue was resolved another way — say so on the PR line as `*(redundant — already on <branch>)*`.
Stale dependency PRs routinely outlive the fix that superseded them.

### Step 5: Brief the user

Print the ranked bands, then a single **"Do this next"** recommendation — the highest-value
P0 (else the top P1, and so on) with one line of why. Stop. Do not begin the work.

A **merge-ready PR outranks starting new work** when it carries a security fix or a dependency
bump: it is finished work sitting one click from shipping, so leaving it open while beginning
something else is strictly worse than merging it first.

State the PR ↔ issue linkage in the recommendation itself. "Merge #24 — it closes P0 #25" is
actionable; "merge #24" alone makes the operator go look up why it matters.

## `/pstatus --all` (portfolio sweep — read-only, no writes)

- Resolve the active repo list: `gh repo list <owner> --no-archived --source --limit 200 --json nameWithOwner`.
- For each repo, gather open Dependabot alerts + open issues labeled `P0` + open PRs.
- Print a cross-repo table: `repo | open P0 | open security alerts | open PRs | top item`.
- Recommend which repo needs attention first. Create no issues in sweep mode.
