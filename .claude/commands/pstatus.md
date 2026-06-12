# /pstatus — ranked briefing & next step

A read-and-reconcile command. Run it **often** — ideally right before `/session-commit`.
It surfaces security first, ranks open work by priority, regenerates `TODO.md`, and
recommends what to do next. It does not start work.

## Scope

- `/pstatus` — the current repo (default).
- `/pstatus --all` — portfolio sweep across every active repo (P0 / security everywhere).

## Steps (single repo)

### Step 1: Gather (run in parallel, read-only)

- Security signals:
  - `gh api /repos/{owner}/{repo}/dependabot/alerts?state=open`
  - `gh api /repos/{owner}/{repo}/code-scanning/alerts?state=open` (ignore a 404 — feature off)
  - any other scanner signal available (e.g. GitGuardian)
- `gh issue list --state open --limit 100 --json number,title,labels`
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

- Any open issue with **no** priority label (`P0` / `P1` / `P2` / `deferred`) gets `needs-triage`
  so it shows up as awaiting a decision rather than being silently mis-ranked.

### Step 4: Rank and regenerate `TODO.md`

Overwrite `TODO.md` with the open issues grouped into bands. The `▶ Resume here` pointer is owned by
`/wrap` (written at session end) — `/pstatus` does not write or preserve it; once you've resumed it
has served its purpose, so regenerating a bands-only `TODO.md` here is expected:

- `🔴 P0 — Security & Critical` (list `security` / vulnerability issues first)
- `🟠 P1`
- `🟡 P2`
- `⏸ Deferred`
- `❓ Needs triage` (count + titles)

Each line: `- #<num> <title>`.

### Step 5: Brief the user

Print the ranked bands, then a single **"Do this next"** recommendation — the highest-value
P0 (else the top P1, and so on) with one line of why. Stop. Do not begin the work.

## `/pstatus --all` (portfolio sweep — read-only, no writes)

- Resolve the active repo list: `gh repo list <owner> --no-archived --source --limit 200 --json nameWithOwner`.
- For each repo, gather open Dependabot alerts + open issues labeled `P0`.
- Print a cross-repo table: `repo | open P0 | open security alerts | top item`.
- Recommend which repo needs attention first. Create no issues in sweep mode.
