---
name: execute-plan
description: Use when a concrete plan already exists and the next job is to convert it into ordered tasks and start executing immediately.
---

# Execute Plan

Use this skill when a concrete plan already exists and the next job is to turn it into tasks and start executing.

## Reach for This Skill When
- a generated or approved plan already exists
- the plan is clear enough to execute without substantial re-planning
- the user wants implementation, task creation, or progression through the recommended order

## Outcome
- an ordered task tree that mirrors the plan
- the first unblocked leaf task is `in_progress`
- execution continues through remaining in-scope tasks until blocked or complete

## Workflow
1. Treat the plan as the execution source; do not re-plan from scratch unless new evidence forces it.
2. Verify that the plan still matches the user request, current scope, and constraints.
3. Preserve the plan's recommended order in the task graph unless a safer dependency order is required.
4. Create parent/container tasks only for major phases/groups; put real coding, validation, migration, and documentation work in child leaf tasks.
5. Put references, target files, invariants, and acceptance details into the relevant task descriptions instead of separate bookkeeping tasks.
6. Mark the first executable leaf task `in_progress` and begin execution in the same run.
7. After each completed leaf task, call `TaskList`, pick the next unblocked in-scope leaf task, and continue.
8. If the plan omits required in-scope work, add concrete tasks and continue.
9. Stop only for blockers, ambiguity, failed validation that needs a decision, or scoped completion.

## Task Rules
- Prefer one leaf task per independently completable unit of work.
- Use parent/container tasks only for coordination.
- Do not create vague executable tasks like `execute phase 2`, `continue slice C`, or `finish the rest`.
- Treat `Continue` as instruction to resume from the task list.
- Do not stop after task creation or after an informational checkpoint if more unblocked work remains.
- If a leaf task introduces non-obvious logic or compatibility behavior, include targeted comment/documentation work in its done state.

## Scope and Estimates
- Treat the plan and user request together as the source of in-scope work.
- Do not stop merely because the initial task list is exhausted.
- If the current referenced plan document is incomplete, keep working that document rather than proposing the next one.
- Surface later-phase, optional, or materially broader work explicitly instead of silently expanding scope.
- Do not volunteer effort estimates unless the user explicitly asks; prefer remaining tasks, dependencies, blockers, and uncertainty.

## Delegation
- Delegate only focused, low-coupling leaf tasks.
- Use `agentType` and `TaskExecute` when available.
- Keep parent responsibility for integration, conflict resolution, and final validation.
