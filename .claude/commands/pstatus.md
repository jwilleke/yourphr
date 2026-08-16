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
  - **the ecosystem's own audit against the lockfile — not optional, and not covered by the
    above.** `npm audit` / `yarn audit` / `pnpm audit`, `pip-audit`, `bundle audit`,
    `govulncheck`, `cargo audit`, whatever the repo's package manager provides. Advisory
    scanners match by registry coordinates, so a dependency resolved from a **git URL**, a
    fork, or vendored into the tree has nothing to match and can never raise an alert. A clean
    alerts page is not evidence that the tree is clean — a critical advisory has sat in a
    shipped bundle for months while the page read `0 open`.
    - **Read the exit code with the tool's own documentation open.** They disagree: `npm audit`
      exits 0 or 1, Yarn Classic exits a bitmask of the severities it found (1 info, 2 low, 4
      moderate, 8 high, 16 critical), so a single low finding exits `2`. Treating any non-zero
      as failure makes the check permanently red, and a permanently red check gets ignored.
    - Severity filters are not uniform either — Yarn Classic's `--level` does not filter, it
      still reports and still counts. Verify the flag does what you think before relying on it.
    - Findings here are scanner signals like any other: bridge them into issues in Step 2 using
      the advisory ID as the marker.
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

- Any open **issue** with **no** placement label (`P0` / `P1` / `P2` / `deferred` / `in-review`) gets
  `needs-triage` so it shows up as awaiting a decision rather than being silently mis-ranked. An
  `in-review` issue is already placed (it lands in the In review band) and is never flagged.
- Open **PRs** are not auto-labeled; their band is derived in Step 4 (see **PR priority**). Unplaced
  PRs land in **Needs triage** the same way unplaced issues do — never a separate unranked dump.

### Step 4: Rank and regenerate `TODO.md`

Overwrite `TODO.md` with open issues **and** open PRs grouped into the **same** priority bands.

**Remove the `▶ Resume here` block, including its `RESUME:START` / `RESUME:END` markers.** The
pointer is written by `/wrap` at session end and read by `/context` at session open; by the time
`/pstatus` runs you have already resumed, so it has served its purpose. The output of this step is a
bands-only `TODO.md` — that is intended, not a loss. `/pstatus` never reads the block and never
preserves it.

**`TODO.md` carries no history.** It is a snapshot of what is open *right now* — nothing else. No
"merged since last run", no "4 of 7 have landed", no counts of what was closed, no narrative of what
happened this session, no dated changelog, and no section for work in other repos. If an item is
closed or merged, it simply stops appearing; that disappearance is the only record `TODO.md` keeps.

Session history belongs in `docs/project_log.md` (or `private/project_log.md` where the repo keeps
it there), written by `/session-commit` and `/wrap`. Never in `TODO.md`. Two files recording the
same events drift apart, and the drift is silent: the ranked backlog starts reading as a status
report and the operator has to work out which half is current.

The bands, in this order (issues **and** PRs share these bands):

- `🔴 P0 — Security & Critical` (list `security` / vulnerability items first)
- `🟠 P1`
- `🟡 P2`
- `🔵 In review` (items labeled `in-review` — work complete and pushed, awaiting the operator's
  decision to close; takes precedence over a priority label so it surfaces as "ready for your call")
- `⏸ Deferred`
- `❓ Needs triage` (issues and PRs with no resolvable placement)

**There is no separate `🔀 Open PRs` band.** Every open PR appears exactly once under the same
priority band as issues. A flat PR-only section hid deps work from the ranked backlog (Dependabot
PRs sat at the bottom while P1 coding looked "empty").

**One entry per line — never bundle.** Each issue or PR gets its OWN bullet, starting with a full
clickable GitHub link. No grouping headers that pack several refs onto one bullet, no
comma-separated runs of numbers, no bare `#<num>`.

Issue line:

`- [#<num>](https://github.com/{owner}/{repo}/issues/<num>) — <title>`

PR line (always mark state; always name related issues when any):

`- [#<num>](https://github.com/{owner}/{repo}/pull/<num>) — <title> _(PR · ready | draft | conflicted)[ · stale Nd]_ — closes|refs|likely [#n](…) | no linked issue`

Use **underscore** emphasis, not asterisks. The kit's own `.markdownlint.jsonc` sets MD049 to
`underscore`, so an asterisk-wrapped state marker makes the generated `TODO.md` fail
`npm run lint:md` in the very repo that produced it.

**Wrap any bare URL that appears in a title.** Issue and PR titles regularly contain a raw
`https://…`, which lands in `TODO.md` as a bare URL and fails MD034 — a red lint run on a file
nobody hand-edited. Put angle brackets around it: `<https://…>`. This applies to URLs in the
**title text** only; never touch the link target of the `[#N](…)` reference itself.

#### PR priority (same bands as issues)

Resolve related issues first (next subsection), then place the PR:

1. **Explicit PR labels** — if the PR itself has `P0` / `P1` / `P2` / `deferred` / `in-review`, use
   that (same precedence as issues: `in-review` wins over a priority label).
2. **Inherit from linked issues** — among open issues linked via `closes` / `refs` / `likely`, take
   the **highest** priority: `P0` > `P1` > `P2`. Prefer a linked `security` issue's grade when
   present. If every linked open issue is only `in-review` or `deferred`, place the PR with that
   placement (`in-review` / `deferred`).
3. **Else Needs triage** — including Dependabot/Renovate PRs with no resolvable issue. Do **not**
   invent a silent default priority for unlinked deps bumps; they must show up as untriaged so
   someone grades them (or links them to a tracking issue).

Within a band, list **security-related** items first, then by descending number. Interleave issues
and PRs in that order (do not dump all PRs at the bottom of the band).

**No entry may appear twice in `TODO.md`.** Every issue and every PR gets exactly one line in the
whole file. When an issue's fix is already in an open PR, it belongs to the PR's line — as a
`closes` / `refs` / `likely` link — and is **not** also listed as a standalone issue line. Two lines
for one piece of work inflates the apparent backlog and makes the file read as though the fix has
not been written yet.

State the absence rather than deleting it silently: a band with no remaining open items says so,
e.g. `_None._` An empty band and a band whose work is only awaiting merge of a PR listed in another
band are different — the PR's placement is the truth; do not leave a ghost issue line.

Verify before finishing — every count must be 1:

```bash
grep -oE '/(issues|pull)/[0-9]+' TODO.md | sort | uniq -c | sort -rn
```

#### Resolving a PR's related issues

A PR shown without its issue context reads as unrelated housekeeping, so resolve the link for every
PR. In order:

1. **Declared** — `closingIssuesReferences` from Step 1. These are the issues GitHub will
   auto-close on merge; render them as `closes #<n>`.
2. **Mentioned** — any `#<n>` in the PR body that is not a closing reference; render as `refs #<n>`.
3. **Inferred** — for a dependency-bump PR with neither, match the package name against open
   `security` issue titles and bodies (including the `scanner-alert:` markers from Step 2). A
   Dependabot PR bumping package `X` and a tracking issue for an advisory in `X` are the same work
   arriving from two directions. Render as `likely #<n>` — never as `closes`, since it is a guess.

If none of the three resolve, write `no linked issue` explicitly rather than leaving the line bare.
A silent absence is indistinguishable from "not checked".

An issue whose fix is already sitting in an open PR is **not** actually open work, and the ranking
must not recommend starting something already written. Per the no-duplicate rule above, it is
carried by the PR's line in the PR's priority band, where the actionable verb is "merge" rather
than "start".

Where a PR turns out to be redundant — the change is already on the default branch, or a tracking
issue was resolved another way — say so on the PR line as `_(redundant — already on <branch>)_`.
Stale dependency PRs routinely outlive the fix that superseded them. Flag open more than 7 days as
`stale Nd` in the state marker.

### Step 5: Brief the user

Print the ranked bands, then a single **"Do this next"** recommendation — the highest-value
P0 (else the top P1, and so on) with one line of why. Stop. Do not begin the work.

A **merge-ready PR outranks starting new work** when it sits in P0/P1 (or carries a security /
dependency fix): it is finished work sitting one click from shipping, so leaving it open while
beginning something else is strictly worse than merging it first.

State the PR ↔ issue linkage in the recommendation itself. "Merge #24 — it closes P0 #25" is
actionable; "merge #24" alone makes the operator go look up why it matters.

## `/pstatus --all` (portfolio sweep — read-only, no writes)

- Resolve the active repo list: `gh repo list <owner> --no-archived --source --limit 200 --json nameWithOwner`.
- For each repo, gather open Dependabot alerts + open issues labeled `P0` + open PRs.
- Print a cross-repo table: `repo | open P0 | open security alerts | open PRs | top item`.
- Recommend which repo needs attention first. Create no issues in sweep mode.
