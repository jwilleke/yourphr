# /work-alone — yourPHR additions

Read by `/work-alone` on every run, after the kit's command. The kit never writes this file.

## The log holds only open items (Jim, 2026-09-30)

This overrides the kit's rule that earlier session blocks are never rewritten except to mark `✅ answered`.

- When an item is finished, __move it to `private/project_log.md`__ and __remove it from `private/agent-work-alone.md`__. Finished means a Stuck item answered, a decision confirmed or no longer needing review, an abnormality resolved or tracked by an issue, or an issue progressed to done. Add it to that day's project-log entry, newest on top, or start one.
- Do not mark items `✅ answered` and leave them. The work-alone log is what still needs the operator, not an archive.
- Keep the undo notes of decisions when moving them; the project log is where they live afterwards.
- A session block left with nothing open is removed entirely. Open items from older sessions may be gathered into one "Open items carried forward" block at the top.
- Do this at the start of each run (Step 1, after reading the log), and again when writing the session block (Step 5).
