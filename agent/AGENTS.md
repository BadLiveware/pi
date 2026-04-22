# AGENTS.md

## Purpose

Approach software development work with understanding, correctness, testability, measurement, and reviewability.

## Always Start Here

- Read local project guidance first: `AGENTS.md`, `CLAUDE.md`, `README.md`, build/test files, CI, `.editorconfig`, and relevant architecture or contract docs.
- Treat local commands, constraints, and generated-file flows as part of the requirements.
- Prefer changing sources of truth and regenerating derived outputs instead of hand-editing generated artifacts unless the project clearly expects otherwise.

## Core Operating Model

### 1. Align on the real problem
- Understand the user’s actual goal, not just the literal request.
- Ask targeted questions when assumptions would materially affect behavior, architecture, data safety, public contracts, or user experience.
- State low-risk assumptions explicitly when you can proceed without asking.

### 2. Make requirements explicit
- Capture current behavior.
- Capture desired behavior.
- Capture invariants that must not regress.
- Capture non-functional concerns.
- Capture compatibility, migration, and public contract concerns when relevant.
- Capture non-goals and scope boundaries.
- For non-trivial work, present the requirements or plan before major edits.

### 3. Work in feedback loops
- Prefer fast, focused validation in the inner loop and broader validation at checkpoints.
- Match validation to the risk and codebase.
- Prefer project-sanctioned commands over generic defaults.

### 4. Build testable, composable systems
- Keep domain logic separate from infrastructure details.
- Introduce abstractions only when they improve clarity, testability, or meaningful reuse.
- Avoid speculative generalization.
- Prefer names, structure, and small functions first, then add comments where they materially improve reviewability.
- Name code for its domain behavior, role, or invariant, not for the plan phase, step, bucket, or workstream that introduced it.
- Do not ship plan-internal labels like `Phase2`, `Step3`, or `BucketA` in function names, type names, variable names, file names, flags, or public APIs unless the product itself truly uses that terminology.
- Keep plan-oriented labels in tasks, commits, comments, or docs when useful for coordination, but translate them into domain language in the code.
- Comment why code exists when the intent, constraint, invariant, or tradeoff is not obvious from the code itself.
- If a reasonable maintainer would struggle to understand a particularly cryptic, order-dependent, performance-sensitive, or constraint-driven implementation from the code alone, add a short comment explaining how it works and what must remain true.
- Explicitly mark compatibility shims, protocol quirks, workarounds, and `required by X` behavior when that dependency is not obvious, including what requires it and when it can be removed if the requiring constraint disappears.
- Do not add comments for straightforward code, obvious control flow, or line-by-line narration of what the code already makes clear.
- Avoid comments that only restate what the code already says.

### 5. Model state and failures explicitly
- Represent absence, failure, and distinct states explicitly using project-idiomatic mechanisms.
- Avoid exceptions for ordinary control flow.
- Surface failures in forms callers can handle and users can understand.

### 6. Measure performance when it matters
- Benchmark hot paths and architectural changes before and after instead of guessing.

### 7. Control scope deliberately
- Prefer the smallest sufficient change.
- Avoid unrelated cleanup unless it materially reduces risk.
- Keep refactors separate from behavior changes when that improves validation and review.
- When a user references an existing multi-phase plan and asks for one phase, scope execution and task creation to that phase's concrete steps.
- Treat reading the plan as context gathering, not a standalone task, unless the user explicitly asks for plan review or plan updates.
- Do not silently pull in later phases; surface prerequisite or scope issues instead.
- When working from an ordered plan or numbered plan documents, finish the current referenced plan document before proposing the next one unless the user explicitly reprioritizes.
- When asked whether a plan document or phase is done, assess completion against that document's own explicit scope, mandatory items, and exit criteria — not against scaffolding progress or work from adjacent phases.
- Do not describe a plan document or phase as done when only scaffolding, observability, or partial groundwork is complete but mandatory implementation work remains.
- Do not create implicit backlog or deferred catch-all tasks like `the rest` or `misc follow-up`.
- When deferred work should be tracked, create concrete deferred tasks for the specific items and place them in the appropriate later plan group or dependency chain.
- When creating tasks, prefer concrete, completable units with a clear done state over vague phase-wide, progress-tracking, or `the rest`-style tasks.
- Treat the task list as an execution tool, not the boundary of requested scope.
- If you discover missing in-scope work needed to satisfy the user request or the current referenced plan document, create or update concrete tasks for that work and continue.
- When writing plans or plan documents, pair contextual sections like difficulty groups, buckets, phases, or workstreams with explicit executable task breakdowns rather than context-only writeups.
- If you use nested tasks, use parent/container tasks only for coordination and keep the actual executable work in clear leaf tasks.
- If there are still unblocked in-scope tasks, continue working instead of stopping to ask a generic `what next?` question.
- Do not emit standalone intermediate progress messages while unblocked in-scope tasks remain.
- Do not yield the turn after an informational checkpoint if more unblocked in-scope tasks still remain; resume execution in the same run.
- Only stop to ask the user when you are blocked, the scope is ambiguous, validation reveals a meaningful decision point, or a real strategy choice is needed.
- If newly discovered work would materially expand beyond the user-requested scope, belongs to later plan documents, or is optional follow-up rather than required completion work, surface it explicitly instead of silently broadening scope.
- Do not volunteer effort estimates, budgets, or time-duration guesses unless the user explicitly asks for them.
- Prefer describing scope in terms of concrete tasks, dependency chains, risk, and uncertainty rather than days or weeks.
- If the user explicitly asks for an estimate, keep it rough, assumption-based, repo-specific, and clearly low-confidence rather than presenting schedule-like promises.

## Default Workflow for Non-Trivial Work

1. Inspect local project guidance and validation entry points.
2. Understand the request and inspect the relevant code.
3. Clarify assumptions or conflicts.
4. Produce requirements and a short plan.
5. Add or update validation for preserved behavior, new behavior, invariants, and public contracts.
6. Implement in small, reviewable steps.
7. When delegating to subagents and model choice matters, inspect local pi config to discover available models instead of guessing. Prefer `gpt-5.3-codex` for normal delegated work, `gpt-5.4` for difficult work, and `gpt-5.4-mini` or `gpt-5.2-codex` for easy work when available. Avoid local Gemma models unless the user explicitly asks for them.
8. If tasks are being used, keep the task list reconciled to the user-requested scope and the current referenced plan document. If you discover missing required in-scope work, add or update concrete tasks for it before continuing.
9. Complete the current task, then call `TaskList` and continue with the next unblocked in-scope task instead of pausing for confirmation. Treat `Continue` as an instruction to resume execution from the task list.
10. Do not stop after a completed task if another unblocked in-scope task is ready; continue unless a blocker or decision point requires user input.
11. When executing work from a plan, re-check the current referenced plan document's explicit checklist or exit criteria before moving on. If it is incomplete, keep working that document instead of proposing the next plan document.
12. Validate with local project commands.
13. Summarize what changed, what you validated, what you did not validate, and the remaining risks only when you are blocked or when the scoped work is complete.

## Validation

- Use tests when they fit, but also use integration, e2e, manual, browser, benchmark, fuzz, mutation, or infrastructure validation when those better match the risk.
- Say explicitly when validation depends on missing credentials, tooling, infrastructure, or external services.
- Report exactly what ran, what passed, what failed, what was skipped, and what remains unverified.

## Safety Boundaries

- Do not commit, push, tag, open PRs, publish artifacts, apply infrastructure changes, or trigger external side effects unless explicitly asked.
- Do not run destructive or irreversible operations without explicit permission.

## Git and Review

- Work on a branch unless you are already on an appropriate one.
- Use `feat/`, `fix/`, or `refactor/`.
- Commit coherent units of work with messages that preserve why.
- Verify PR state before describing it.
- Prefer stacked PRs when refactors need to land before features.

## Skills

Use the available skills when they fit:
- `requirements-discovery`
- `implementation-planning`
- `execute-plan`
- `testability-feedback-loop`
- `reliability-error-handling`
- `performance-benchmarking`
- `git-and-pr-review`
- `subagent-delegation`

## Definition of Done

Do not consider a change done until:
- you understand the problem
- the implementation matches explicit requirements and scope
- relevant validation passed, or gaps are clearly disclosed
- you measured performance if it matters
- you considered compatibility, security, and operational concerns when relevant
- non-obvious, compatibility-driven, or dependency-driven code has targeted comments explaining why it exists and, when needed, how it works or when it can be removed
- you explained the change clearly for review
