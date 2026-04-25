# Long/Split Bounded Plan Execution

Use this reference from `execute-plan` when a bounded plan is split across a master `README.md` plus numbered files, very large, checkpoint-heavy, or likely to invite premature status pauses.

## Principle
Long/split plans are still bounded. Execute the current referenced document and its exit criteria before moving on, unless the user reprioritizes.

## Setup
1. Read the master overview for purpose, constraints, order, dependency graph, and final acceptance criteria.
2. Read only the active numbered file plus immediate prerequisite/handoff context needed for safe execution.
3. Create a durable progress note if useful, but do not duplicate large plan content.
4. Create/reconcile a rolling task window of roughly 5-8 active leaf tasks.
5. Mark the first executable task `in_progress` and begin implementation in the same run.

## Execution
1. Stay on the active numbered file until its mandatory tasks and exit criteria are complete.
2. Work the next unblocked checklist item in order unless a safer dependency order is required.
3. After each meaningful increment: update tasks/progress notes, record validation evidence/gaps, and commit if permission is active and the work is a validated semantic checkpoint.
4. When a numbered file completes, record validation and handoff notes, then continue to the next file without a standalone status report unless a stop condition applies.
5. If checklist is exhausted but original scope is not complete, add missing concrete items and continue.
6. Record out-of-scope discoveries under notes/deferred work without silently expanding scope.

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

Do not mention source plan, plan path, numbered file, stage, phase, checklist item, Ralph loop, or task bookkeeping unless the artifact is internal progress material.
