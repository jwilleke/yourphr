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

- `P0` critical/security · `P1` high · `P2` normal · `deferred` postponed · `needs-triage` unassigned.
- Security comes first. Scanner alerts (Dependabot / code-scanning / GitGuardian) become
  issues labeled `security` + a graded priority: critical/high → `P0`, medium → `P1`, low → `P2`.
- `TODO.md` = a `▶ Resume here` block (maintained by `/wrap`) on top, then priority bands that
  `/status` regenerates from the labels. Do not hand-edit the bands.

## Working agreement

- Think before coding: state assumptions, surface trade-offs, ask when scope is ambiguous.
- Simplicity first: the minimum that solves the problem; nothing speculative.
- Use Conventional Commits for messages.

## Markdown conventions

- Dash (`-`) bullets; no bare numbered lists. ATX (`#`) headings. Spaced tables (`| a | b |`).
- Inline HTML is **not** allowed. Long lines are fine.
- Rules live in `.markdownlint.jsonc`; the editor, CLI, CI and agents all read that one file.
<!-- KIT:END -->

## Project Context

<!-- What this repo is, how to build / run it, and the key decisions an agent must know. -->

## Status

- project_state: active
- blockers: none
