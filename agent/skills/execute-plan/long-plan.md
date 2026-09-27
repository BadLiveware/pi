# Long/Split Bounded Plan Execution

Use this reference from `execute-plan` when a bounded plan separates a semantic `README.md` from `work-breakdown.md`, is very large or checkpoint-heavy, or is likely to invite premature status pauses.

## Principle
Long/split plans are still bounded. `README.md` defines what the change means; `work-breakdown.md` defines how implementation is decomposed; tasks or Stardock state track what is happening now. Do not use planning-file boundaries as execution boundaries.

## Setup
1. Read `README.md` for the problem, domain model, current and desired semantics, invariants, scope, compatibility expectations, and whole-change acceptance conditions.
2. Read `work-breakdown.md` for work nodes, dependencies, semantic requirement references, ownership, node acceptance, validation, and attempt bounds.
3. Verify every mandatory semantic requirement maps to at least one node and every node links back to the semantics it implements. Resolve contradictions in favor of the user request and observed repository truth; do not silently let mechanical decomposition redefine behavior.
4. For ordinary serial execution, load the next ready node and only the supporting `work/`, `docs/`, or `design/` context it references. For Stardock, either submit a compact graph at once or create a draft and upsert bounded node groups as their context is loaded; do not treat those batches as execution waves.
5. Accept legacy `stardock-dag.md`, numbered execution files, or an execution-heavy README when executing an existing plan, but normalize their responsibilities mentally rather than rewriting them mid-execution without need.
6. If multiple PRs were explicitly requested, treat delivery as a separate repository-specific workflow after the implementation DAG; never infer PR boundaries from nodes or files.
7. Create a durable progress note if useful, but do not copy semantic or node contracts into it.
8. Create/reconcile a rolling task window of roughly 5-8 ready leaf tasks, or finish authoring and seal the executable topology with `stardock_plan`.
9. Verify sealing succeeded before calling `stardock_run`; then mark the first local task `in_progress` or run the complete ready set and begin implementation in the same run.

## Execution
1. Execute dependency-ready nodes from `work-breakdown.md`. For Stardock, run the maximal ready antichain; for local serial work, choose the next ready node without inventing file-based ordering.
2. Use README sections as semantic acceptance authority and node contracts as implementation acceptance authority. If they conflict, stop and resolve the plan defect rather than choosing whichever is easier.
3. Read supporting context on demand; completing or exhausting a context file does not complete a node.
4. After each meaningful increment, update tasks, Stardock DAG/wave state, or progress notes; record validation evidence/gaps; and commit by default when the work is a safe validated semantic checkpoint.
5. When a node completes, record its validation and continue to the next ready node without a standalone status report unless a stop condition applies.
6. If listed nodes are exhausted but README acceptance remains unmet, add the missing execution job instead of declaring completion.
7. Record out-of-scope discoveries under notes/deferred work without silently expanding semantic scope.

## Stop Policy
Do not stop merely for status, completed chunks, validation passes, `git status`, phase completion, or promising checkpoints.

Stop only when:
1. requested scope and current plan exit criteria are complete
2. a blocker requires user input, credentials, policy approval, or architectural/product decision
3. destructive, irreversible, or externally visible action needs approval
4. validation reveals a failure that cannot be safely resolved in scope
5. context is nearly exhausted and a handoff is required

Before summarizing, ask: "Is there any unblocked in-scope work left?" If yes, keep executing.

## Artifact Hygiene
Plans are internal scaffolding. Produced code, docs, generated files, comments, migrations, config, examples, and user-facing text must be domain-facing, not plan-facing.

Do not mention source plan, plan path, numbered file, stage, phase, checklist item, Stardock loop, or task bookkeeping unless the artifact is internal progress material.
