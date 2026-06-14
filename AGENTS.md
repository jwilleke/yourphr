<!-- KIT:START — managed by mjs-project-template; edit below the KIT:END marker -->
# Agent Context & Protocols

This section is **managed by the kit** (`install-kit.sh`) — it is identical across
repos. Put repo-specific context **below the `KIT:END` marker**; do not edit here.

## Session continuity

- Before starting, read the `▶ Resume here` block at the top of `TODO.md` (committed, so it
  syncs across machines) and recent `git log`. That is where the last session left off —
  repeating finished work is the most common avoidable mistake.
- Commit a chunk of work with `/session-commit`: commits code + `TODO.md`, appends a journal
  entry to `private/project_log.md` (the log is never committed).
- Run `/status` often (after every `/session-commit`): it ranks open work and recommends
  the next step.
- End a session with `/wrap`: commits anything outstanding, refreshes the `▶ Resume here`
  pointer, and reports whether it is safe to shut down the editor.

## Priorities — GitHub labels are the source of truth

Priority labels are mutually exclusive and mean:

- `P0` — **Broken. Stop all work and fix it.** (production down / blocked / security breach)
- `P1` — **Delivers value to the mission.**
- `P2` — **Nice to have.**
- `deferred` — consciously postponed; `needs-triage` — awaiting a priority decision.

Then:

- Security comes first. Scanner alerts (Dependabot / code-scanning / GitGuardian) become
  issues labeled `security` + a graded priority: critical/high → `P0`, medium → `P1`, low → `P2`.
- `TODO.md` = a `▶ Resume here` block (maintained by `/wrap`) on top, then priority bands that
  `/status` regenerates from the labels. Do not hand-edit the bands.

## Working agreement

- Think before coding: state assumptions, surface trade-offs, ask when scope is ambiguous.
- Simplicity first: the minimum that solves the problem; nothing speculative.
- Use Conventional Commits for messages.
- Issue decomposition — NEVER put "Steps", "Phases", or numbered sequences inside a single
  GitHub issue. Break each step into its own issue and link them using GitHub relationships:
  `closes #N` / `fixes #N` (resolves another), `blocked by #N` (dependency), `relates to #N`
  (context link). Example: a 3-phase migration = 3 issues with "blocked by" chains, not one
  issue with Phase headings.

## Markdown conventions

- Dash (`-`) bullets; no bare numbered lists. ATX (`#`) headings. Spaced tables (`| a | b |`).
- Inline HTML is **not** allowed. Long lines are fine.
- Rules live in `.markdownlint.jsonc`; the editor, CLI, CI and agents all read that one file.
<!-- KIT:END -->

## Project Context

<!-- What this repo is, how to build / run it, and the key decisions an agent must know. -->

## Workflow conventions

### Multi-phase work — one issue per phase, linked via GitHub relationships

When work is broken into phases, create a **separate GitHub issue per phase** and link each to the parent feature/epic using GitHub's **sub-issue / tracked-by relationships**. Do **not** track phases only in commit messages or issue comments — phases tracked that way get lost. The parent issue holds the overview; each phase is its own independently labelable, prioritizable, and closeable issue. Reference the parent from each phase issue and close phase issues as they ship.

## Status

- project_state: active
- blockers: none
