---
name: execute-long-plan
description: Use when a concrete implementation plan is long-running, multi-phase, checkpoint-prone, or explicitly meant to be executed end-to-end without intermediate status pauses.
---

# Execute Long Plan

Use this when a concrete plan is substantial enough that ordinary execution would invite premature status checkpoints. It combines plan execution discipline with a Ralph loop so progress has a durable place to go without stopping in chat.

Before using this skill, read and follow `pi-ralph-wiggum` if available. If not, use the Ralph tools directly and follow this file.

## When to Use
Use when a generated/approved plan already exists and it spans phases, numbered documents, many checklist items, many validation cycles, durable progress notes, or the user asks to execute end-to-end / keep going / avoid status pauses.

Do not use for planning-only/status-only requests, quick fixes, short debugging passes, or plans too ambiguous to execute safely. Use `planning` or `requirements-discovery` first when needed.

## Outcome
- `.ralph/<loop-name>.md` with goals, scope, checklist, validation evidence, and notes
- Ralph loop started for the long plan
- optional task window for the next concrete leaf items
- execution continues through all unblocked in-scope work until complete or stopped
- progress recorded in `.ralph`, tasks, or plan files rather than standalone chat updates
- validated semantic checkpoint commits by default unless user opts out or safety blocks committing

## Split Plan Handling
Treat a referenced path as split when it is a directory or master overview containing ordered numbered files such as `01-*.md`, `02-*.md`.

For split plans:
1. Read the master overview first for purpose, constraints, order, dependency graph, and final acceptance criteria.
2. Read only the active numbered file plus immediate prerequisite/handoff context needed for safe execution.
3. Execute one numbered file at a time; finish its mandatory tasks and exit criteria before moving on unless the user reprioritizes.
4. Keep `.ralph` hierarchical: top-level numbered files with active-file leaf items.
5. When a numbered file completes, record validation and handoff notes in `.ralph`, then continue to the next file without a standalone status report.
6. Judge overall completion against the master overview after all numbered files are complete.

If a single plan is huge and planning is still in scope, prefer asking whether to split it. If execution is already requested, create a Ralph checklist by major headings and continue.

## Stop Policy
Do not stop merely for status, completed chunks, validation passes, `git status`, phase completion, or promising checkpoints.

Stop only when:
1. requested scope and current plan exit criteria are complete
2. a blocker requires user input, credentials, policy approval, or architectural/product decision
3. destructive, irreversible, or externally visible action needs approval
4. validation reveals a failure that cannot be safely resolved in scope
5. context is nearly exhausted and a handoff is required
6. Ralph reaches its configured max iterations

Before any user-facing summary, ask: "Is there any unblocked in-scope work left?" If yes, update `.ralph` and continue.

## Artifact Hygiene
Plans are internal scaffolding. Code, docs, generated files, comments, migrations, config, examples, and user-facing text must be domain-facing, not plan-facing.

Do not mention source plan, plan path, numbered file, stage, phase, checklist item, Ralph loop, or task bookkeeping unless the artifact is internal progress material. Translate plan requirements into repository/product concepts. Scan plan-derived docs for `stage`, `phase`, `plan`, `checklist`, `.agents`, `.ralph`, and plan directory names unless the product domain genuinely uses them.

## Commit Checkpoints
Long-plan execution commits by default because work is usually branch-based, substantial, and painful to reconstruct after a dump commit. Use `commit` after each validated semantic unit or numbered plan file that leaves the repository coherent.

Do not commit if the user opts out, branch/workspace state is unsafe, validation failed and the change is not a useful explicitly marked recovery point, the change is incomplete scaffolding or a line-item fragment, or committing would trigger a prohibited side effect. Do not push unless explicitly asked or another workflow pushes by default.

## Readiness Review
Before starting the loop, scan the active plan for missing requirements, unanchored purpose, untestable leaf tasks, placeholders, missing acceptance criteria, missing validation/expected signals, and artifact hygiene risks.

Treat unanchored or over-inferred purpose as a blocker: clarify with the user or reduce work to explicit discovery/intake tasks. For high-risk plans, consider `../planning/plan-quality-review.md` and resolve blockers unless gaps are explicitly accepted.

## Setup Workflow
1. Confirm the plan is executable, in scope, locally valid, and purpose-anchored.
2. Detect split plan structure and read only master plus active file context.
3. Run readiness review and resolve blockers or accepted gaps.
4. Create `.ralph/<loop-name>.md` before `ralph_start`. Include goals/non-goals, source plan references, current scope, exit criteria, ordered checklist, verification section, and notes. Use `ralph-template.md` when helpful.
5. Call `ralph_start` with the same loop name and file content.
6. If task tools help, create/reconcile only the next rolling window of roughly 5-8 active leaf tasks.
7. Mark the first executable item in progress and begin implementation in the same run.

## Execution Workflow
1. Treat the plan plus `.ralph/<loop-name>.md` as execution source of truth.
2. For split plans, stay on the active numbered file until its mandatory tasks and exit criteria are complete.
3. Work the next unblocked checklist item in order unless a safer dependency order is required.
4. After each meaningful increment: update `.ralph`, record verification evidence/gaps, update tasks if used, and commit if it is a validated semantic checkpoint.
5. Call `ralph_done` after real iteration progress so the loop can continue.
6. Continue immediately with the next unblocked in-scope item unless the Stop Policy applies.
7. When task window runs low but `.ralph` has more work, add only the next few concrete tasks.
8. If checklist is exhausted but original scope is not complete, add missing concrete items and continue.
9. Record out-of-scope discoveries under notes/deferred work without silently expanding scope.
10. Output `<promise>COMPLETE</promise>` only after scope and exit criteria are complete and validation evidence/gaps are recorded.

## Delegation and Model Choice
- For delegation details, use `subagent-delegation`.
- Before assigning work to a non-current model, call `list_pi_models` and choose supported enabled models.
- Parent keeps responsibility for integration, acceptance, checkpoint commits, and final validation.

## Validation and Completion
- Prefer project-sanctioned commands; record exact commands/inspections and expected signals.
- Use fast focused checks during implementation and broader validation at meaningful milestones.
- Record exactly what ran, passed, failed, was skipped, and remains unverified in `.ralph`.
- If credentials, services, hardware, or external systems are unavailable, record the dependency and continue only when safe.
- Final response should summarize completed work, files/artifacts, validation, blockers/gaps, and whether `<promise>COMPLETE</promise>` was emitted.
