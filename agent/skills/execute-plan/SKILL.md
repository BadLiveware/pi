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
- semantic checkpoint commits are created when the user has asked for commits or another active workflow grants commit permission

## Plan Execution Stop Policy
When executing a plan, do not stop merely to report status. Treat checkpoint summaries as internal artifacts unless the user explicitly asked for a status-only response.

Stop only when one of these conditions is true:
1. The full requested scope and current plan exit criteria are complete.
2. A blocker requires user input, credentials, policy approval, or an architectural/product decision.
3. A destructive, irreversible, or externally visible action needs explicit approval.
4. Validation reveals a failure that cannot be safely resolved within the current scope.
5. Context is nearly exhausted and a handoff summary is required.

Before sending a user-facing summary during plan execution, ask: "Is there any unblocked in-scope work left?" If yes, do not summarize in chat; continue with the next task.

## Artifact Hygiene
Execution plans are internal scaffolding. Produced artifacts must read as domain-facing repository work, not as outputs of a plan.

Apply this to code, docs, generated files, examples, comments, migrations, config, and user-facing text:
- Do not mention the source plan, plan path, numbered plan file, stage, phase, checklist item, task bookkeeping, or execution process unless the artifact is itself an internal execution/progress artifact.
- Translate plan requirements into product/repository concepts rather than phrases like “this stage”, “Stage 05”, or “the optimization plan”.
- Keep plan provenance in task descriptions, plan checklists, local evidence logs, commit messages, and final chat summaries; do not put it in repository artifacts.
- Before completing plan-derived docs or generated outputs, scan for plan-leak phrases like `stage`, `phase`, `plan`, `checklist`, `.agents`, and the plan directory name; remove them unless the product domain genuinely uses them.

## Plan Readiness Review
Before converting a moderately complicated plan into tasks, scan it for execution blockers:
- missing requirements coverage
- leaf tasks that are not independently testable/reviewable
- vague placeholders such as `TODO`, `TBD`, `handle edge cases`, `add tests`, `similar to previous`, or `fill in later`
- missing acceptance criteria or validation
- validation without exact commands/inspection checks or expected signals where knowable
- artifact hygiene risks, especially plan/stage/checklist language leaking into produced docs/code

If the plan is moderately complicated or high-risk and these checks are non-obvious, use the reviewer prompt in `../planning/plan-quality-review.md` before executing.

## Structured Task Descriptions
When creating tasks from a plan, put execution-critical detail in each leaf task description. Replace every `...` placeholder before creating the task; unresolved placeholders mean the task is not ready.

```md
**Goal:** ...

**Files / areas:**
- Modify: `path` or affected area

**Acceptance criteria:**
- [ ] Concrete pass/fail criterion

**Validation:**
- Command or inspection: `...`
- Expected signal: ...
- Gaps: ...

**Risks / notes:** ...
```

## Commit Checkpoints
Use `commit` when commit permission is active. Commit after each validated semantic unit that can be reviewed, tested, and reverted independently. Do not wait until the whole plan is done if that would create a dump commit, and do not commit tiny line-item fragments or incomplete scaffolding.

Commit permission is active only when the user explicitly asked for commits or another active workflow includes committing. If commit permission is not active, leave changes uncommitted and summarize suggested commit boundaries at completion when useful.

## Workflow
1. Treat the plan as the execution source; do not re-plan from scratch unless new evidence forces it.
2. Verify that the plan still matches the user request, current scope, and constraints.
3. Preserve the plan's recommended order in the task graph unless a safer dependency order is required.
4. Run the Plan Readiness Review and resolve blockers before execution unless the user explicitly asks to proceed with known gaps.
5. Create parent/container tasks only for major phases/groups; put real coding, validation, migration, and documentation work in child leaf tasks.
6. Keep the task list UI-scannable. The panel commonly shows about 10 rows total, including completed tasks; for larger plans, create only the next rolling window of roughly 5-8 active leaf tasks and keep future backlog in the plan until it is near execution.
7. Put references, target files, invariants, acceptance criteria, and validation details into the relevant task descriptions instead of separate bookkeeping tasks.
8. Mark the first executable leaf task `in_progress` and begin execution in the same run.
9. After each completed leaf task, if commit permission is active and the completed work forms a validated semantic checkpoint, use `commit` before continuing.
10. After each completed leaf task, call `TaskList`, pick the next unblocked in-scope leaf task, and continue.
11. When the visible active window drops low and more plan work remains, add the next few concrete leaf tasks rather than materializing the whole remaining plan.
12. If the task list is exhausted but the plan scope is not complete, add the missing concrete tasks and continue.
13. If the plan omits required in-scope work, add concrete tasks and continue.
14. Stop only for the conditions in the Plan Execution Stop Policy.

## Task Rules
- Prefer one leaf task per independently completable, testable, reviewable unit of work that would make a plausible commit boundary.
- Do not mirror every future plan item into tasks when that would push useful work out of the visible task panel; keep future items in the plan and add them just before execution.
- Use parent/container tasks only for coordination.
- Do not create vague executable tasks like `execute phase 2`, `continue slice C`, or `finish the rest`.
- Treat `Continue` as instruction to resume from the task list.
- Do not stop after task creation, successful validation, `git status`, completion of a phase/chunk, or an informational checkpoint if more unblocked work remains.
- If progress needs to be captured mid-plan, update the task list, plan checklist, notes file, or local evidence log; do not emit a standalone progress report to the user.
- If a leaf task introduces non-obvious logic or compatibility behavior, include targeted comment/documentation work in its done state.
- TDD cycles happen inside implementation tasks; do not create separate bookkeeping tasks for red/green/refactor unless test infrastructure itself is the deliverable.

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
