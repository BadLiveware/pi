---
name: execute-plan
description: Use when a concrete plan already exists and the next job is to convert it into ordered tasks and start executing immediately.
---

# Execute Plan

Use this skill when a concrete plan or loop charter already exists and the next job is to turn it into tasks/attempts and start executing. Decide whether execution is bounded or unbounded, simple or split/long, then read the matching reference when more detail is needed.

## Shape Decision
Infer execution shape from the source and user intent; do not wait for the user to say "bounded" or "unbounded".

- **Bounded plan**: finite scope and exit criteria; execute through all unblocked in-scope tasks until complete or blocked.
- **Unbounded loop**: open-ended work that replenishes attempts from evidence; read `unbounded-work.md` before creating attempts or editing code, use a rolling 1-3 attempt window, and do not stop just because the current queue is empty.
- **Split/long bounded plan**: semantic `README.md` plus `work-breakdown.md` and optional supporting context, very large bounded scope, or many checkpoints; read `long-plan.md` before proceeding.

Common unbounded signals include: loop/iteration language, optimize/tune/harden/improve continuously, measure/check→change→evaluate→accept/reject cycles, replenishing hypotheses from evidence, stop only when the user stops, or durable negative-result memory to avoid retracing paths.

If a prompt mixes continuous/open-ended intent with "quick" or "finite for now" convenience pressure, treat it as unbounded unless the user explicitly asks for a bounded pilot.

## Outcome
- ordered task/attempt window that mirrors the current plan or loop scope
- first unblocked leaf task/attempt marked `in_progress`, followed by immediate execution
- bounded execution continues through all unblocked in-scope tasks until blocked or complete
- unbounded execution continues through evaluated attempts until user stop, blocker, or agreed stop criteria
- progress recorded in tasks, notes, plan files, loop files, or Stardock evidence records instead of standalone status chat
- semantic checkpoint commits by default when completed work is safe to commit

## Stop Policy
Do not stop merely to report status after task creation, validation, `git status`, a completed chunk, or an informational checkpoint.

Stop only when:
1. requested bounded scope and current plan exit criteria are complete, or unbounded loop stop criteria are met
2. a blocker requires user input, credentials, policy approval, or architectural/product decision
3. destructive, irreversible, or externally visible action needs approval
4. validation reveals a failure that cannot be safely resolved in scope
5. context is nearly exhausted and a handoff is required

Do not stop merely because the remaining work is invasive, cross-cutting, or difficult. If it is still the clearest in-scope next move, strengthen validation, narrow the active slice, or add enabling seams/instrumentation, then keep going.

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
- for split plans, a semantic README separated from a complete implementation breakdown and supporting reference/design context
- for Stardock-backed plans, an executable DAG shape with prerequisites, independent ownership, validation, and attempt bounds rather than duplicated checklist/brief detail

For high-risk plans, use `../planning/plan-quality-review.md` before executing. Resolve blockers unless the user explicitly accepts gaps.

## Stardock-Backed Execution

For finite bounded work with meaningful dependencies or independent leaves, use the graph-first Stardock surface instead of converting each execution item into a serial worker cycle.

- Author the DAG from `work-breakdown.md`. Use the default one-shot `stardock_plan` action for compact graphs; for large graphs, create a draft, upsert bounded node groups, inspect status, and seal. Treat README semantics and authoring batches as context, not node boundaries.
- Treat nodes as arbitrary jobs, not PRs, branches, or mandatory code producers. A node may return a report, findings, decisions, throw-away test results, artifacts, commits, or no filesystem changes.
- Treat interface, schema, migration, research, or shared-contract work as prerequisite nodes when later jobs depend on their output. Expose every independent dependent leaf; do not serialize siblings merely because they share a prerequisite.
- Model integration, promotion, cherry-picking, combined validation, or release as an explicit dependent node when it is part of the work. Use `stardock_integrate` only as an optional compatibility/convenience path for accepted commit-producing lanes, not as a mandatory post-review phase.
- Call `stardock_run` once per ready wave. It dispatches the complete maximal ready antichain through bounded isolated workers; a width-one ready set is naturally serial.
- Inspect the settled reports, artifacts, validation observations, and focused diffs when present, then call `stardock_review` once with an accept/reject decision for every returned `runId`. Do not launch a routine reviewer worker between node execution and governor acceptance.
- Treat failed checks, no-edit results, attempt exhaustion, and cleanup warnings as decision evidence rather than semantic gates. The governor may accept warning-bearing evidence, retry with rationale, supersede, abandon, or call `stardock_complete`; unresolved state is retained as warnings, and you must never claim the framework made the completion decision.
- Use `stardock_status` after resume/compaction or when graph state is unclear. Keep governor context focused on the user's request, dependency handoffs, evidence, decisions, risks, and available actions.
- Legacy Stardock tools are diagnostics/recovery only for new plans. They are restored automatically for planless legacy loops and can otherwise be enabled explicitly with `/stardock-legacy on`.
- For unbounded experimentation, use the runner-neutral attempt loop in `unbounded-work.md` rather than forcing a finite DAG. Use legacy recursive Stardock only for an existing planless loop or an explicit human request.

## Task Creation Rules
- Create only the next UI-scannable rolling window of roughly 5-8 active leaf tasks; keep future backlog in `work-breakdown.md`.
- Prefer one leaf task per independently completable, testable, reviewable unit that could be a semantic commit boundary.
- Use parent/container tasks only for coordination.
- Put execution-critical detail in each leaf task/attempt: goal or hypothesis, files/areas, acceptance criteria or decision rules, validation/evaluation, risks/notes.
- Do not create vague tasks like `execute phase 2`, `continue slice C`, `finish the rest`, or separate red/green/refactor bookkeeping tasks.

## Commit Checkpoints
Use `commit` for completed semantic units by default. Commit after each validated semantic unit that can be reviewed, tested, and reverted independently. Do not commit tiny fragments, incomplete scaffolding, or unvalidated changes unless the validation gap is explicit and committing is still useful. A semantic checkpoint is not permission to leave the requested behavior half-done when more unblocked in-scope work remains.

Do not commit when the user opted out, the execution is inspect-only/draft/WIP, repository or branch state needs a user decision, or no safe coherent commit exists. Otherwise leave only intentionally uncommitted changes and explain why.

## Workflow
1. Treat the plan or loop charter as execution source; do not re-plan unless evidence forces it.
2. Verify the source still matches user request, current scope, and local constraints.
3. Classify bounded vs unbounded and simple vs split/long. For unbounded work, read `unbounded-work.md` before creating attempts, starting background work, or editing code; do not substitute a one-off task list for the loop runner.
4. For split plans, read `README.md` for semantic meaning and `work-breakdown.md` for implementation topology. For ordinary serial execution, load the current node plus its referenced context. For incremental Stardock authoring, load and upsert bounded node groups until every contract is represented, then seal. Accept legacy `stardock-dag.md` or numbered execution files as older input shapes, but do not produce them for new plans.
5. Preserve recommended order unless a safer dependency order is required.
6. Run readiness review and resolve blockers or accepted gaps.
7. For Stardock-backed bounded plans, author and seal the execution topology with `stardock_plan`, then let `stardock_run` dispatch the complete ready set before governor edits; accepted evidence unlocks dependent nodes, while any integration or promotion is an explicit node or an optional compatibility operation.
8. Create/reconcile the next concrete task/attempt window and mark the first executable leaf `in_progress`.
9. Execute the task/attempt in the same run.
10. If the current task is enabling work such as seams, instrumentation, or preparatory refactors, use the improved feedback loop to continue into the dependent behavior change in the same execution whenever it remains unblocked and in scope.
11. After each leaf task/attempt: update task/Stardock state, validate/evaluate, commit by default when the work is a safe semantic checkpoint, call `TaskList` when task tools are in use, and continue with the next unblocked in-scope item.
12. When the visible window runs low, add the next few concrete tasks from the plan or next 1-3 hypotheses from the loop charter.
13. If tasks are exhausted but bounded plan scope is not complete, add missing concrete tasks and continue; if an unbounded loop queue is empty, replenish from evidence instead of stopping.
14. If progress needs recording mid-plan, update tasks, Stardock records, plan checklist, notes, loop file, or local evidence log; do not emit standalone progress chat.

## Scope Control
- Treat the plan/loop charter and user request together as the source of in-scope work.
- Do not stop because the initial task/attempt list is exhausted.
- If the current bounded work node is incomplete, keep working it before proposing optional broader scope; do not treat a context-file boundary as a completion boundary.
- Reconcile task lists immediately when switching plan, phase, or context; delete/supersede obsolete pending tasks and irrelevant old completed tasks when they no longer support current execution.
- Surface optional or broader work explicitly instead of silently expanding scope.

## Delegation
- For delegation details, use `subagent-delegation`.
- Before choosing a non-current model for delegated plan work, call `list_pi_models` and choose supported enabled models.
- Delegate only focused, low-coupling leaf tasks; parent owns integration, conflicts, acceptance, and final validation.
