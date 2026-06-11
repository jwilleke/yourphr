---
description: Survey live GitHub state (Dependabot, failing Actions, open bugs/PRs, easy wins) and recommend next moves for jwilleke/yourphr
argument-hint: "[optional: focus area, e.g. 'bugs' or 'ci']"
allowed-tools: Bash(gh:*), Bash(git:*), Read, Glob, Grep
---

# /check-todos

This command helps focus on high-priority and current work by showing:

- GitHub Dependabot alerts or other vulnerabilities
- **Failing GitHub Actions runs** — scheduled / recurring workflows on `master` whose most-recent run is red (silent failures otherwise sit in Actions tab unread)
- Open `[BUG]`s in ngdpbase
- **Waiting on Review Sign-off** — work shipped, `in review` label set, operator verification is the only thing left before close
- Open PRs (ngdpbase and satellites)
- Operator-decision carryover (e.g., recommended-close issues)
- **Easy wins** — open issues that match the easy-win criteria below (bounded scope, no new deps, low risk)
- **Deferred** — open issues carrying the `deferred` label, listed separately so parked work doesn't get mixed into active priorities

Survey the **live** state of `jwilleke/yourphr` on GitHub and prioritize what to work on next. Read from GitHub, not from a snapshot file — `private-jims/TODO.md` is a curated note that drifts.

Repo: `jwilleke/yourphr` · default branch: `main`.

If `$ARGUMENTS` names a focus area (e.g. `ci`, `bugs`, `deps`), lead with that section and keep the rest brief.

## Survey (run these, then summarize)

1. **Security / Dependabot** — open alerts:

   ```
   gh api repos/jwilleke/yourphr/dependabot/alerts \
     --jq '[.[] | select(.state=="open") | {number, path: .dependency.manifest_path, package: .security_vulnerability.package.name, severity: .security_advisory.severity, ghsa: .security_advisory.ghsa_id}]'
   ```

   Report one table: `Severity · Package · Path · GHSA`, sorted severity desc. This repo has both a Go module (`go.mod`) and a JS app (`frontend/`), so alerts can land under either manifest — keep the path column. If the API 404s, Dependabot isn't enabled; say so instead of reporting "none".

2. **Failing GitHub Actions on `main`** — recurring/CI workflows whose latest run is red:

   ```
   gh run list --repo jwilleke/yourphr --branch main --status failure --limit 15 \
     --json name,conclusion,createdAt,databaseId,url
   ```

   Dedupe to the **most-recent failing run per workflow**, and drop any workflow that has since had a green run (compare against `gh run list --branch main --limit 30`). For each still-red workflow, include name, last-failed time, and the failing-job error:

   ```
   gh run view <databaseId> --repo jwilleke/yourphr --log-failed | grep -aE "##\[error\]|--- FAIL|panic|Cannot find|MODULE_NOT_FOUND" | head
   ```

   Note: `CodeQL` and the neutralized upstream workflows (`docker.yaml`, `cloud-deploy.yaml`, `cdn-deploy.yaml`, `release.yaml`) should not appear here — if one does, that's the signal something regressed.

3. **Open BUGs** — `gh issue list --repo jwilleke/yourphr --state open --label bug --json number,title,updatedAt`. Count + list by recency.

4. **Open PRs** — `gh pr list --repo jwilleke/yourphr --state open --json number,title,headRefName,isDraft,reviewDecision`. Flag any that are mergeable / awaiting your sign-off.

5. **Easy wins** — `gh issue list --repo jwilleke/yourphr --state open --label "good first issue" --json number,title,labels`, plus `--label "help wanted"`, plus any open issue that passes the filter below. Cap at 5. For each: number, title, one-line "what to do", and why it qualifies.

6. **TODO.md staleness** — if `private-jims/TODO.md` exists, flag it when its mtime is older than ~2 weeks (`git log -1 --format=%cr -- private-jims/TODO.md`, or stat the file). It's a snapshot; the durable trail is GitHub issue history + `private-jims/project_log.md`.

## Easy-win filter

An open issue qualifies only when **all** hold (any miss = disqualified; when in doubt, disqualify):

- **1–2 commits of focused work** — bounded scope, clear deliverable in the body.
- **No blocking dependencies** — no "blocked on #N" / "depends on #N".
- **No new third-party dependencies** (no new Go module or npm package).
- **No new architecture decisions** — obvious shape, no "needs a plan" framing.
- **Low security/UX risk** — does not touch auth/JWT, encryption, the FHIR
  ingestion path (`SyncAllBundle`, search-parameter extraction), or generated
  models (`backend/pkg/models/database/fhir_*.go`) in nontrivial ways.
- **Well-tested or purely additive** — affects a tested path, or adds a new
  helper / test / docs page with a clear boundary.
- **No `enhancement`-as-epic** — multi-slice feature work doesn't qualify even if it sounds small.

Qualifies: a bugfix where the diagnosis is already in the body; a missing test for an existing function; a small UI tweak with one acceptance criterion; a docs page for a well-understood topic; a non-US-Core display fallback for one FHIR resource type.

Does NOT qualify: new provider/source integrations; changes to the generated FHIR models or the codegen; new rendering pipelines; anything labelled as an epic or opening with "needs a plan".

## Output

Match the section order above. End with **Recommended next moves** — 2–4 concrete actions. Keep it scannable; this is a prioritization aid, not a report.
Each open GH Issue is expeccted to have one line as to its status.

## Update private-jims/TODO.md (ALWAYS — this is the point)

Rewriting `private-jims/TODO.md` from the live survey is a **core, required step of every `/check-todos` run** — not optional. After the survey, regenerate the file so it reflects current GitHub state. `private-jims/` is gitignored, so this stays local.

Rules for `TODO.md`:

- **Forward-looking only.** Open/parked items — what we're *going to* do. Never keep DONE/closed entries; history of what was done lives in `project_log.md`. Before writing the file, check each issue's live state (`gh issue view <N> --json state`) and **drop every `CLOSED` one** — no exceptions.
- **Needs-review section.** An issue that is *finished but awaiting review* (code done, only sign-off / verification / a decision left) does **not** go in the normal forward-looking lists and is **not** closed. Instead: (1) add the GitHub **`question`** label (`gh issue edit <N> --add-label question`), and (2) list it under a dedicated `## Needs review (\`question\` label)` heading. Include that heading only when ≥1 such issue exists; omit it otherwise.
- **Qualify PRs vs issues.** Write Pull Requests as `PR #N` and issues as bare `#N` (a bare `#N` is ambiguous; the distinction matters). Applies in TODO.md, project_log, commits, and chat.
- **Always inline clickable links.** Every issue/PR ref is `[#NN](https://github.com/jwilleke/yourphr/issues/NN)` (for a PR, the link text is `PR #NN`) — never a bare `#NN`, never reference-style `[#NN]` with defs at the bottom (Jim wants to click the ref and land on the issue, with the URL visible in the raw editor). For `jwilleke/mj-infra-flux` use `[mj-flux#NN](https://github.com/jwilleke/mj-infra-flux/issues/NN)`.
- **Lint clean.** Follow `.markdownlint.json` (MD013 line length 900 — forward-only keeps lines short; split a rare over-long paragraph at a sentence boundary).
