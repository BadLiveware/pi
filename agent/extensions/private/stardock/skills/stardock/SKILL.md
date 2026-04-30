---
name: stardock
description: Use when starting, driving, or inspecting private Stardock implementation loops: checklist loops for finite work, recursive bounded attempts, governor/outside request workflows, and evidence-backed multi-iteration progress. Avoid for simple one-shot tasks or quick fixes.
---

# Stardock

Stardock is a private Pi implementation framework for governed agentic work. Current capabilities are checklist and recursive loops; future work will add criteria, compact context packets, verification artifacts, auditor oversight, and bounded worker handoffs.

Use `stardock_start` to begin a loop. Choose `mode: "checklist"` for finite known work or `mode: "recursive"` for bounded try/test/reset attempts on open-ended objectives:

```js
stardock_start({
  name: "loop-name",
  mode: "checklist",
  taskContent: "# Task\n\n## Goals\n- Goal 1\n\n## Checklist\n- [ ] Item 1\n- [ ] Item 2",
  maxIterations: 50,
  itemsPerIteration: 3,
  reflectEvery: 10
})
```

Recursive mode requires an `objective` and may include `baseline`, `validationCommand`, `resetPolicy`, `stopWhen`, `maxFailedAttempts`, `outsideHelpEvery`, `governEvery`, and `outsideHelpOnStagnation`.

## Workflow

1. Prepare clear task content with goals, checklist/criteria, and validation expectations.
2. Start the loop with `stardock_start`; it creates `.stardock/<name>.md` from `taskContent`.
3. Work one bounded iteration.
4. Record progress and verification evidence in the task file.
5. For recursive loops, use `stardock_attempt_report` when available.
6. Call `stardock_done` to proceed to the next iteration.
7. Output `<promise>COMPLETE</promise>` only when the scoped work is done.

If outside-help/governor requests appear, inspect them with `stardock_outside_requests`, fetch ready-to-copy work with `stardock_outside_payload`, satisfy them manually or with a parent/orchestrator workflow, then record answers with `stardock_outside_answer`. Use `stardock_govern` for an immediate manual governor review request and payload without spawning subagents.

## Commands

- `/stardock start <name|path> [--mode checklist|recursive]` — start a loop.
- `/stardock resume <name>` — resume a paused loop.
- `/stardock stop` — pause the current loop when idle.
- `/stardock-stop` — stop active loop when idle.
- `/stardock status` — show loops.
- `/stardock list --archived` — show archived loops.
- `/stardock govern [loop]` — create a manual governor review request and payload.
- `/stardock outside [loop]` — show outside-help/governor requests.
- `/stardock outside payload <loop> <request-id>` — show a ready-to-copy governor/researcher task payload.
- `/stardock outside answer <loop> <request-id> <answer>` — record a plain-text outside request answer.
- `/stardock archive <name>` — move loop to archive.
- `/stardock clean [--all]` — clean completed loops.
- `/stardock cancel <name>` — delete loop.
- `/stardock nuke [--yes]` — delete all `.stardock` data.

Press ESC to interrupt streaming, send a normal message to resume, and run `/stardock-stop` when idle to end the loop.

## Task file shape

```md
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

## Guidance

- Keep each iteration bounded.
- Record evidence before claiming progress.
- Prefer project-native validation commands.
- Use governor/outside requests to break out of local-lane fixation.
- Do not preserve `ralph_*`, `/ralph`, or `.ralph/` compatibility unless explicitly useful for local migration.
