---
name: execute-long-plan
description: Use when a concrete implementation plan is long-running, multi-phase, checkpoint-prone, or explicitly meant to be executed end-to-end without intermediate status pauses. Sets up a Ralph loop, records progress in .ralph, and continues through unblocked in-scope work until complete or blocked.
---

# Execute Long Plan

Use this skill when a concrete plan already exists and the work is substantial enough that ordinary task execution is likely to create premature status checkpoints. This skill combines plan execution discipline with a Ralph loop so progress has a durable place to go without stopping in chat.

Before using this skill, read and follow `pi-ralph-wiggum` if available.

## Reach for This Skill When
- a generated or approved implementation plan already exists
- the plan spans multiple phases, documents, chunks, or milestones
- the plan has many concrete checklist items or validation cycles
- the user asks to execute end-to-end, keep going, continue autonomously, or avoid status-report pauses
- prior attempts stopped after intermediate checkpoints, successful validation, `git status`, or partial phase completion
- durable progress, evidence, and resumability matter

## Do Not Use This Skill When
- the user asked for planning only or status only
- the task is a quick fix, small edit, or short debugging pass
- the plan is still too ambiguous to execute safely; use `implementation-planning` or `requirements-discovery` first
- starting a Ralph loop would add more overhead than value

## Outcome
- a `.ralph/<loop-name>.md` task file with goals, scope, checklist, validation evidence, and notes
- automatic recognition of split plan directories with a master `README.md` and numbered plan files
- a started Ralph loop for the long plan
- optional task-list entries that mirror concrete executable work when useful
- execution proceeds through all unblocked in-scope work until the plan is complete or a stop condition is reached
- progress summaries are recorded in `.ralph`, tasks, or plan files instead of sent as standalone chat updates

## Split Plan Detection
Treat a referenced path as a split long plan when it is a directory containing:
- `README.md` or another obvious master overview, and
- ordered numbered markdown files such as `01-*.md`, `02-*.md`, `03-*.md`.

Also detect a split plan when the user references a master `README.md` whose execution order links to numbered markdown files in the same directory.

When a split plan is detected:
1. Read the master overview first and treat it as the source for global purpose, constraints, execution order, dependency graph, and final acceptance criteria.
2. Discover numbered plan files in lexical order unless the master overview explicitly gives a different order.
3. Read only the current numbered file and any immediate prerequisite/handoff context needed for safe execution. Do not load every numbered file into context unless necessary.
4. Execute one numbered file at a time. Finish the current file's mandatory tasks and exit criteria before moving to the next numbered file unless the user reprioritizes.
5. Keep the Ralph checklist hierarchical: top-level entries for numbered files, with detailed leaf items for the active file.
6. When a numbered file is complete, record validation evidence and handoff notes in `.ralph`, then continue to the next numbered file without a standalone chat status report.
7. Judge overall completion against the master overview's final acceptance criteria after all numbered files are complete.

If a referenced plan is a single very large markdown file rather than a split directory, prefer asking whether to split it first when planning is still in scope. If the user has already asked to execute it now, create a Ralph checklist by major headings and continue under this skill.

## Stop Policy
Do not stop merely to report status. A completed chunk, phase, validation pass, `git status`, or promising checkpoint is not a stopping condition.

Stop only when one of these is true:
1. The full requested scope and current plan exit criteria are complete.
2. A blocker requires user input, credentials, policy approval, or an architectural/product decision.
3. A destructive, irreversible, or externally visible action needs explicit approval.
4. Validation reveals a failure that cannot be safely resolved within the current scope.
5. Context is nearly exhausted and a handoff summary is required.
6. The Ralph loop reaches its configured max iterations.

Before sending any user-facing summary during execution, ask: "Is there any unblocked in-scope work left?" If yes, do not summarize in chat; update `.ralph` and continue.

## Inner Loop Summaries
Brief summaries at Ralph iteration boundaries are useful, but they are not stopping points.

Allowed inner-loop summaries:
- update `.ralph/<loop-name>.md` with what changed, evidence, and next checklist item
- record task-list comments/status when task tools are being used
- note validation commands, artifacts, failures, and follow-up work in the Ralph file
- provide a very short handoff only if context is nearly exhausted or the loop/tool explicitly requires a user-visible checkpoint

Avoid user-facing standalone summaries after normal inner-loop progress. If more unblocked in-scope work remains, the summary belongs in `.ralph`; then call `ralph_done` and continue.

## Setup Workflow
1. Confirm the referenced plan is clear enough to execute and still matches the user request and local constraints.
2. Detect whether the plan is a split plan directory using Split Plan Detection.
3. Choose a short lowercase hyphenated loop name derived from the plan or feature, for example `sweep-workflow`.
4. Create `.ralph/<loop-name>.md` before calling `ralph_start`. Include:
   - goals and non-goals
   - source plan references, including the master overview and numbered files for split plans
   - current scope and exit criteria
   - an ordered checklist of concrete implementation, validation, docs, and cleanup items
   - for split plans, top-level checklist items for each numbered file and active-file leaf tasks under the current file
   - a verification section for commands, outputs, artifacts, and remaining gaps
   - notes for decisions, blockers, and scope changes
5. Call `ralph_start` with the same loop name and the file content.
6. If task tools are useful, create or reconcile concrete leaf tasks that mirror the same checklist. Do not create vague tasks like `finish the rest`.
7. Mark the first executable item in progress and begin implementation in the same run.

## Execution Workflow
1. Treat the plan plus `.ralph/<loop-name>.md` as the execution source of truth.
2. For split plans, stay on the current numbered file until its mandatory tasks and file-local exit criteria are complete.
3. Work the next unblocked checklist item in order unless a safer dependency order is required.
4. After each meaningful increment:
   - update `.ralph/<loop-name>.md` checklist state
   - record verification evidence, command results, artifact paths, or explicit gaps
   - update task-list state if tasks are being used
5. Call `ralph_done` after real iteration progress so the loop can continue.
6. Continue immediately with the next unblocked in-scope item unless the Stop Policy applies.
7. For split plans, when the active numbered file is complete, mark that top-level file item complete in `.ralph`, record handoff notes, read the next numbered file, add its concrete leaf items, and continue without a standalone user-facing checkpoint.
8. If the checklist is exhausted but the original plan scope is not complete, add the missing concrete items to `.ralph` and continue.
9. If new in-scope work is discovered, add concrete checklist items and continue. If out-of-scope work is discovered, record it under notes/deferred work without silently expanding scope.
10. Output `<promise>COMPLETE</promise>` only after the requested scope and exit criteria are truly complete and validation evidence or gaps are recorded.

## Ralph File Template

```markdown
# <Plan Name>

Execute <plan/source> end-to-end without pausing for intermediate status reports.

## Goals
- ...

## Non-goals
- ...

## Source Plan / Scope
- Plan file or user request: ...
- Master overview for split plans: ...
- Numbered files for split plans: ...
- Current scope: ...
- Exit criteria: ...

## Checklist
- [ ] 01-<slice>.md
  - [ ] Concrete implementation item for active file
  - [ ] Concrete validation item for active file
- [ ] 02-<slice>.md
- [ ] Concrete implementation item for single-file plans
- [ ] Concrete validation item for single-file plans
- [ ] Concrete docs or migration item

## Verification
- Pending.

## Notes
- Stop policy: do not emit standalone progress summaries while unblocked in-scope work remains.
```

## Task and Scope Rules
- Keep checklist items concrete and independently verifiable.
- Use parent/container tasks only for coordination; use leaf tasks for actual implementation and validation.
- Keep task names and code names domain-facing; do not put plan labels like `phase2` into code unless the product domain uses them.
- Treat `Continue` as an instruction to resume from `.ralph` and the task list.
- Do not stop after task creation, successful validation, `git status`, phase completion, or an informational checkpoint if more unblocked work remains.
- If progress needs to be captured mid-plan, update `.ralph`, the task list, the plan checklist, or a local evidence log.
- Reconcile `.ralph` and the task list whenever scope changes.
- Judge completion against the current plan's own mandatory items and exit criteria, not against the initial task list alone.

## Validation Rules
- Prefer project-sanctioned commands over generic defaults.
- Use fast focused checks during implementation and broader validation at meaningful milestones.
- Record exactly what ran, what passed, what failed, what was skipped, and what remains unverified in `.ralph`.
- If validation cannot run because credentials, services, hardware, or external systems are unavailable, record the dependency and continue only when safe.

## Completion Response
When the full scope is complete or a stop condition applies, give a concise final summary with:
- what was completed
- key files changed or artifacts produced
- validation run and results
- blockers or unverified gaps, if any
- whether `<promise>COMPLETE</promise>` was emitted
