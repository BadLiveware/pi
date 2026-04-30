---
name: pi-ralph-loop
description: Long-running iterative development loops with pacing control and verifiable progress. Use when tasks require multiple iterations, many discrete steps, or periodic reflection with clear checkpoints; avoid for simple one-shot tasks or quick fixes.
---

# Ralph Loop - Long-Running Development Loops

Use the `ralph_start` tool to begin a loop. Choose `mode: "checklist"` for finite known work or `mode: "recursive"` for bounded try/test/reset attempts on open-ended objectives:

```
ralph_start({
  name: "loop-name",
  mode: "checklist",       // Optional; checklist is the default mode
  taskContent: "# Task\n\n## Goals\n- Goal 1\n\n## Checklist\n- [ ] Item 1\n- [ ] Item 2",
  maxIterations: 50,        // Default: 50
  itemsPerIteration: 3,     // Optional: suggest N items per turn
  reflectEvery: 10          // Optional: reflect every N iterations
})
```

Recursive mode requires an `objective` and may include `baseline`, `validationCommand`, `resetPolicy`, `stopWhen`, `maxFailedAttempts`, `outsideHelpEvery`, `governEvery`, and `outsideHelpOnStagnation`. Each recursive iteration should be one bounded hypothesis/attempt with evidence recorded in the task file. Use `ralph_attempt_report` to record structured attempt data when available. If outside-help/governor requests appear, inspect them with `ralph_outside_requests`, fetch ready-to-copy work with `ralph_outside_payload`, satisfy them manually or with a parent/orchestrator workflow, then record answers with `ralph_outside_answer`. Use `ralph_govern` for an immediate manual governor review request and payload without spawning subagents.

## Loop Behavior

1. Prepare clear task content with goals, a checklist, and validation expectations.
2. Start the loop with `ralph_start`; it creates `.ralph/<name>.md` from `taskContent`.
3. Work on the task and update the file each iteration.
4. Record verification evidence (commands run, file paths, outputs) in the task file.
5. Call `ralph_done` to proceed to the next iteration.
6. Output `<promise>COMPLETE</promise>` when finished.
7. Stop when complete or when max iterations is reached (default 50).

## User Commands

- `/ralph start <name|path> [--mode checklist|recursive]` - Start a new loop.
- `/ralph resume <name>` - Resume loop.
- `/ralph stop` - Pause loop (when agent idle).
- `/ralph-stop` - Stop active loop (idle only).
- `/ralph status` - Show loops.
- `/ralph list --archived` - Show archived loops.
- `/ralph govern [loop]` - Create a manual governor review request and payload.
- `/ralph outside [loop]` - Show outside-help/governor requests.
- `/ralph outside payload <loop> <request-id>` - Show a ready-to-copy governor/researcher task payload.
- `/ralph outside answer <loop> <request-id> <answer>` - Record a plain-text outside request answer.
- `/ralph archive <name>` - Move loop to archive.
- `/ralph clean [--all]` - Clean completed loops.
- `/ralph cancel <name>` - Delete loop.
- `/ralph nuke [--yes]` - Delete all .ralph data.

Press ESC to interrupt streaming, send a normal message to resume, and run `/ralph-stop` when idle to end the loop.

## Task File Format

```markdown
# Task Title

Brief description.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2
- [x] Completed item

## Verification
- Evidence, commands run, or file paths

## Notes
(Update with progress, decisions, blockers)
```

## Best Practices

1. Write a clear checklist with discrete items.
2. Update checklist and notes as you go.
3. Capture verification evidence for completed items.
4. Reflect when stuck to reassess approach.
5. Output the completion marker only when truly done.
