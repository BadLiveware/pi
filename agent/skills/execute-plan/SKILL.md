---
name: execute-plan
description: Use when a concrete plan already exists and the next job is to convert it into ordered tasks and start executing immediately.
---

# Execute Plan

Use this skill when a concrete plan already exists and the next job is to turn it into tasks and start executing.

If the plan is very long, split across a master `README.md` plus numbered files, or likely to require many checkpoint/validation cycles, switch to `execute-long-plan` instead of using this skill.

## Reach for This Skill When
- a generated or approved plan already exists
- the plan is clear enough to execute without substantial re-planning
- the user wants implementation, task creation, or progression through the recommended order

## Outcome
- an ordered task tree that mirrors the plan
- the first unblocked leaf task is `in_progress`
- execution continues through remaining in-scope tasks until blocked or complete
- intermediate progress is recorded in tasks, notes, or plan files instead of emitted as a standalone chat checkpoint

## Plan Execution Stop Policy
When executing a plan, do not stop merely to report status. Treat checkpoint summaries as internal artifacts unless the user explicitly asked for a status-only response.

Stop only when one of these conditions is true:
1. The full requested scope and current plan exit criteria are complete.
2. A blocker requires user input, credentials, policy approval, or an architectural/product decision.
3. A destructive, irreversible, or externally visible action needs explicit approval.
4. Validation reveals a failure that cannot be safely resolved within the current scope.
5. Context is nearly exhausted and a handoff summary is required.

Before sending a user-facing summary during plan execution, ask: "Is there any unblocked in-scope work left?" If yes, do not summarize in chat; continue with the next task.

## Workflow
1. Treat the plan as the execution source; do not re-plan from scratch unless new evidence forces it.
2. Verify that the plan still matches the user request, current scope, and constraints.
3. Preserve the plan's recommended order in the task graph unless a safer dependency order is required.
4. Create parent/container tasks only for major phases/groups; put real coding, validation, migration, and documentation work in child leaf tasks.
5. Put references, target files, invariants, and acceptance details into the relevant task descriptions instead of separate bookkeeping tasks.
6. Mark the first executable leaf task `in_progress` and begin execution in the same run.
7. After each completed leaf task, call `TaskList`, pick the next unblocked in-scope leaf task, and continue.
8. If the task list is exhausted but the plan scope is not complete, add the missing concrete tasks and continue.
9. If the plan omits required in-scope work, add concrete tasks and continue.
10. Stop only for the conditions in the Plan Execution Stop Policy.

## Task Rules
- Prefer one leaf task per independently completable unit of work.
- Use parent/container tasks only for coordination.
- Do not create vague executable tasks like `execute phase 2`, `continue slice C`, or `finish the rest`.
- Treat `Continue` as instruction to resume from the task list.
- Do not stop after task creation, successful validation, `git status`, completion of a phase/chunk, or an informational checkpoint if more unblocked work remains.
- If progress needs to be captured mid-plan, update the task list, plan checklist, notes file, or local evidence log; do not emit a standalone progress report to the user.
- If a leaf task introduces non-obvious logic or compatibility behavior, include targeted comment/documentation work in its done state.

## Scope Control
- Treat the plan and user request together as the source of in-scope work.
- Do not stop merely because the initial task list is exhausted.
- If the current referenced plan document is incomplete, keep working that document rather than proposing the next one.
- When switching to a different plan, phase, or context, reconcile the task list immediately before carrying it forward: keep completed tasks from the current execution round unless they were created in error or clearly replaced/subsumed, delete older completed tasks from irrelevant prior context when they no longer support the current execution scope, and delete or supersede obsolete pending tasks.
- Do not spend a turn deciding about routine housekeeping. If task cleanup, diff inspection, or similar maintenance helps current execution, validation, or review, perform it directly; otherwise keep executing.
- Surface later-phase, optional, or materially broader work explicitly instead of silently expanding scope.

## Delegation
- For delegation details, use `subagent-delegation`.
- Delegate only focused, low-coupling leaf tasks with `agentType` and `TaskExecute` when available, while keeping parent responsibility for integration, conflict resolution, and final validation.
