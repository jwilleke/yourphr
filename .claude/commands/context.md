# Context Command

Read the AGENTS.md file to understand the current project state and context.

This command helps ensure you're aligned with the project's current status, goals, and any ongoing work by other agents.

## Usage

Use `/context` at the start of a session to get up to speed on:

- Project overview and goals
- Current progress and status
- Architecture and tech stack decisions
- Any blockers or issues
- Upcoming tasks and priorities

## Repo-specific additions

This file is __kit-managed and overwritten wholesale__ on every `install-kit.sh` run — anything
you add here is lost at the next sync, silently until the installer started warning about it.

If this repo needs something extra from `/context` — a package manager the kit does not name, a
scanner only this repo has, a path only this repo uses — put it in
`.claude/commands/context.local.md`. The kit never writes, reads, or deletes that file.

__Read it, if it exists, and treat its contents as part of this command.__ A rule that is generic
does not belong there: raise it upstream in
[mjs-project-template](https://github.com/jwilleke/mjs-project-template) so every repo gets it.
