---
name: execute-plan
description: Use when a concrete plan already exists and the next job is to convert it into ordered tasks and start executing immediately.
---

# Execute Plan

Use this skill when a concrete plan or loop charter already exists and the next job is to turn it into tasks/attempts and start executing. Decide whether execution is bounded or unbounded, simple or split/long, then read the matching reference when more detail is needed.

## Shape Decision
Infer execution shape from the source and user intent; do not wait for the user to say "bounded" or "unbounded".

- **Bounded plan**: finite scope and exit criteria; execute through all unblocked in-scope tasks until complete or blocked.
- **Unbounded loop**: open-ended work that replenishes attempts from evidence; read `unbounded-work.md`, use a rolling 1-3 attempt window, and do not stop just because the current queue is empty.
- **Split/long bounded plan**: master `README.md` plus numbered files, very large bounded scope, or many checkpoints; read `long-plan.md` before proceeding.

Common unbounded signals include: loop/iteration language, optimize/tune/harden/improve continuously, measure/check→change→evaluate→accept/reject cycles, replenishing hypotheses from evidence, stop only when the user stops, or durable negative-result memory to avoid retracing paths.

If a prompt mixes continuous/open-ended intent with "quick" or "finite for now" convenience pressure, treat it as unbounded unless the user explicitly asks for a bounded pilot.

## Outcome
- ordered task/attempt window that mirrors the current plan or loop scope
- first unblocked leaf task/attempt marked `in_progress`, followed by immediate execution
- bounded execution continues through all unblocked in-scope tasks until blocked or complete
- unbounded execution continues through evaluated attempts until user stop, blocker, or agreed stop criteria
- progress recorded in tasks, notes, plan files, or loop files instead of standalone status chat
- semantic checkpoint commits when commit permission is active

## Stop Policy
Do not stop merely to report status after task creation, validation, `git status`, a completed chunk, or an informational checkpoint.

Stop only when:
1. requested bounded scope and current plan exit criteria are complete, or unbounded loop stop criteria are met
2. a blocker requires user input, credentials, policy approval, or architectural/product decision
3. destructive, irreversible, or externally visible action needs approval
4. validation reveals a failure that cannot be safely resolved in scope
5. context is nearly exhausted and a handoff is required

Before summarizing, ask: "Is there any unblocked in-scope work left?" If yes, keep executing.

## Artifact Hygiene
Plans are internal scaffolding. Produced code, docs, generated files, examples, migrations, config, comments, and user-facing text must read as domain-facing repository work, not plan output.

Do not mention source plan, path, numbered file, stage, phase, checklist item, task bookkeeping, or execution process unless the artifact is itself internal progress material. Translate plan requirements into product/repository concepts. Scan plan-derived artifacts for `stage`, `phase`, `plan`, `checklist`, `.agents`, and plan directory names unless those terms belong to the product domain.

## Readiness Review
Before converting a non-trivial plan or loop charter into tasks/attempts, scan for:
- missing requirements, unclear scope, or user-request mismatch
- leaf tasks that are not independently testable/reviewable
- placeholders like `TODO`, `TBD`, `handle edge cases`, `add tests`, `similar to previous`, or `fill in later`
- missing acceptance criteria, affected files, validation commands, or expected signals
- artifact hygiene risks

For high-risk plans, use `../planning/plan-quality-review.md` before executing. Resolve blockers unless the user explicitly accepts gaps.

## Task Creation Rules
- Create only the next UI-scannable rolling window of roughly 5-8 active leaf tasks; keep future backlog in the plan.
- Prefer one leaf task per independently completable, testable, reviewable unit that could be a semantic commit boundary.
- Use parent/container tasks only for coordination.
- Put execution-critical detail in each leaf task/attempt: goal or hypothesis, files/areas, acceptance criteria or decision rules, validation/evaluation, risks/notes.
- Do not create vague tasks like `execute phase 2`, `continue slice C`, `finish the rest`, or separate red/green/refactor bookkeeping tasks.

## Commit Checkpoints
Use `commit` when commit permission is active. Commit after each validated semantic unit that can be reviewed, tested, and reverted independently. Do not commit tiny fragments, incomplete scaffolding, or unvalidated changes unless the validation gap is explicit and committing is still useful.

Commit permission is active only when the user asked for commits or another active workflow includes committing. Otherwise leave changes uncommitted and summarize suggested boundaries at completion when useful.

## Workflow
1. Treat the plan or loop charter as execution source; do not re-plan unless evidence forces it.
2. Verify the source still matches user request, current scope, and local constraints.
3. Classify bounded vs unbounded and simple vs split/long. For unbounded work, read `unbounded-work.md` before creating attempts.
4. Preserve recommended order unless a safer dependency order is required.
5. Run readiness review and resolve blockers or accepted gaps.
6. Create/reconcile the next concrete task/attempt window and mark the first executable leaf `in_progress`.
7. Execute the task/attempt in the same run.
8. After each leaf task/attempt: update task state, validate/evaluate, commit if permission is active and the work is a semantic checkpoint, call `TaskList`, and continue with the next unblocked in-scope item.
9. When the visible window runs low, add the next few concrete tasks from the plan or next 1-3 hypotheses from the loop charter.
10. If tasks are exhausted but bounded plan scope is not complete, add missing concrete tasks and continue; if an unbounded loop queue is empty, replenish from evidence instead of stopping.
11. If progress needs recording mid-plan, update tasks, plan checklist, notes, loop file, or local evidence log; do not emit standalone progress chat.

## Scope Control
- Treat the plan/loop charter and user request together as the source of in-scope work.
- Do not stop because the initial task/attempt list is exhausted.
- If the current referenced bounded plan document is incomplete, keep working that document before proposing the next one.
- Reconcile task lists immediately when switching plan, phase, or context; delete/supersede obsolete pending tasks and irrelevant old completed tasks when they no longer support current execution.
- Surface optional or broader work explicitly instead of silently expanding scope.

## Delegation
- For delegation details, use `subagent-delegation`.
- Before choosing a non-current model for delegated plan work, call `list_pi_models` and choose supported enabled models.
- Delegate only focused, low-coupling leaf tasks; parent owns integration, conflicts, acceptance, and final validation.
