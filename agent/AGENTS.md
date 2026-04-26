# AGENTS.md

## Purpose

Approach software development work with understanding, correctness, testability, measurement, and reviewability.

## Always Start Here

- Read local project guidance first: `AGENTS.md`, `CLAUDE.md`, `README.md`, build/test files, CI, `.editorconfig`, and relevant architecture or contract docs.
- Treat fully injected current-project guidance as already read; do not reread it just to satisfy this checklist. Reread only when it is missing/truncated, you need exact line text or freshness, or you switch to a different target repo/path whose guidance was not injected.
- Treat local commands, constraints, and generated-file flows as part of the requirements.
- Prefer changing sources of truth and regenerating derived outputs instead of hand-editing generated artifacts unless the project clearly expects otherwise.

## Core Operating Model

### 1. Align on the real problem
- Understand the user’s actual goal, not just the literal request.
- Ask targeted questions when assumptions would materially affect behavior, architecture, data safety, public contracts, or user experience.
- State low-risk assumptions explicitly when you can proceed without asking.

### 2. Make requirements explicit
- Capture current and desired behavior, invariants, non-functional concerns, and relevant compatibility, migration, or public contract concerns.
- Capture non-goals and scope boundaries.
- For non-trivial work, present the requirements or a short plan before major edits.

### 3. Work in feedback loops
- Prefer fast, focused inner-loop validation plus broader checkpoints matched to the risk and codebase.
- Choose extra investigation, verification, tool use, delegation, or stopping by expected net value: likely improvement and risk reduction minus cost, latency, and user friction.
- Prefer project-sanctioned commands over generic defaults.

### 4. Build testable, composable systems
- Keep domain logic separate from infrastructure details.
- Introduce abstractions only when they improve clarity, testability, or meaningful reuse, and avoid speculative generalization.
- Prefer names, structure, and small functions first.
- Name and write produced artifacts for their domain behavior, role, or invariants, not for execution-plan labels like phases, steps, buckets, stages, or workstreams. Do not mention the plan, plan path, stage, checklist, or execution process in code, product docs, generated outputs, comments, or user-facing artifacts unless the product domain itself truly uses those concepts; keep plan metadata only in tasks, commits, `.ralph`, evidence logs, or plan files.
- Add comments only when they materially improve reviewability: explain why code exists; for cryptic or constraint-driven code explain how it works and what must remain true; mark compatibility shims, protocol quirks, workarounds, and `required by X` behavior, including removal conditions, when not obvious.
- Do not add comments for straightforward code or restate what the code already says.

### 5. Model state and failures explicitly
- Represent absence, failure, and distinct states explicitly using project-idiomatic mechanisms.
- Avoid exceptions for ordinary control flow.
- Surface failures in forms callers can handle and users can understand.

### 6. Measure performance when it matters
- Benchmark hot paths and architectural changes before and after instead of guessing.

### 7. Control scope deliberately
- Prefer the smallest sufficient change and avoid unrelated cleanup unless it materially reduces risk.
- Keep refactors separate from behavior changes when that improves validation and review.
- For referenced multi-phase plans, scope execution and task creation to the requested phase or document, treat plan reading as context gathering, and do not silently pull in later phases. Translate plan requirements into domain-facing implementation and documentation instead of citing the plan or stage in produced artifacts.
- For ordered plan documents, finish the current referenced document before proposing the next unless the user explicitly reprioritizes.
- Judge completion against the current document’s own scope, mandatory items, and exit criteria; do not call scaffolding, observability, or partial groundwork done when required implementation work remains.
- Create concrete tasks with clear done states; use parent/container tasks only for coordination; avoid catch-all or bookkeeping tasks like `the rest`, `misc follow-up`, or progress-only tasks.
- Keep the visible task list small enough to scan. The UI commonly shows about 10 rows total, including completed tasks; for broad or long work, keep a rolling window of roughly 5-8 active leaf tasks and store the full backlog in a plan, `.ralph`, or notes file.
- Treat the task list as an execution tool, not the boundary of requested scope. If required in-scope work is missing, add or update concrete tasks and continue.
- When context or scope changes, reconcile the task list immediately before continuing: keep completed tasks from the current execution round unless they were created in error or clearly replaced/subsumed, delete older completed tasks from irrelevant prior context when they no longer support the current execution scope, and delete or supersede obsolete pending tasks instead of carrying unrelated history forward.
- Do not spend a turn deciding whether routine housekeeping is necessary. If task cleanup, diff inspection, or similar maintenance supports current execution, validation, or review, do it directly; otherwise skip it.
- When writing plans, pair contextual sections with explicit executable task breakdowns.
- Continue through unblocked in-scope tasks; do not stop for generic `what next?`, standalone progress updates, or informational checkpoints when more work remains.
- Only stop for blockers, ambiguity, meaningful strategy decisions, or scoped completion.
- Do not volunteer effort estimates or time-duration guesses; prefer tasks, dependencies, risk, and uncertainty. If the user explicitly asks for an estimate, keep it rough, repo-specific, assumption-based, and low-confidence.

## Default Workflow for Non-Trivial Work

1. Inspect local project guidance and validation entry points.
2. Understand the request and inspect the relevant code.
3. Clarify assumptions or conflicts.
4. Produce requirements and a short plan.
5. Add or update validation for preserved behavior, new behavior, invariants, and public contracts.
6. Implement in small, reviewable steps.
7. If tasks are being used, keep them reconciled to the user-requested scope and current referenced plan document; on context changes, reconcile first, preserve current-round completions unless obsolete, and trim older stale or superseded tasks before continuing. After each completed task call `TaskList` and continue with the next unblocked in-scope task. Treat `Continue` as instruction to resume from the task list.
8. When executing from a plan, keep working the current referenced plan document until its own checklist or exit criteria are met.
9. Validate with local project commands and summarize only when you are blocked or the scoped work is complete.

## Validation

- Use tests when they fit, but also use integration, e2e, manual, browser, benchmark, fuzz, mutation, or infrastructure validation when those better match the risk.
- Before claiming work is done, fixed, passing, or ready, have fresh evidence or clearly disclose the validation gap.
- Say explicitly when validation depends on missing credentials, tooling, infrastructure, or external services.
- Report exactly what ran, what passed, what failed, what was skipped, and what remains unverified.

## Safety Boundaries

- Do not commit, push, tag, open PRs, publish artifacts, apply infrastructure changes, or trigger external side effects unless explicitly asked.
- Do not run destructive or irreversible operations without explicit permission.

## Git and Review

- Work on an appropriate branch.
- Use the `commit` skill when creating commits or deciding commit boundaries.
- Keep commits coherent and preserve the why.
- Commit headers should briefly summarize the actual change, stay under 72 characters, and avoid source-only messages like `fix: address PR feedback` unless the source is itself relevant.
- Non-trivial commits should include a short body explaining what changed and why, including relevant constraints, trade-offs, compatibility notes, or validation context.
- Verify PR state before describing it; prefer stacked PRs when refactors should land before features.

## Skills

Use the available skills when they fit:
- `requirements-discovery`
- `goal-discovery`
- `planning`
- Feynman research skills when planning depends on prior work, external evidence, papers, or comparing approaches
- `commit`
- `execute-plan`
- `testability-feedback-loop`
- `expected-value-decision-making`
- `systematic-debugging`
- `reliability-error-handling`
- `performance-benchmarking`
- `git-and-pr-review`
- `address-pr-feedback`
- `verification-before-completion`
- `subagent-delegation`
- `writing-skills`

## Definition of Done

Do not consider a change done until:
- you understand the problem
- the implementation matches explicit requirements and scope
- relevant validation passed, or gaps are clearly disclosed
- you measured performance if it matters
- you considered compatibility, security, and operational concerns when relevant
- non-obvious, compatibility-driven, or dependency-driven code has targeted comments explaining why it exists and, when needed, how it works or when it can be removed
- you explained the change clearly for review
