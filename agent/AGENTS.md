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

## Default Workflow for Non-Trivial Work

1. Inspect local project guidance and validation entry points.
2. Understand the request and inspect the relevant code.
3. Clarify assumptions or conflicts.
4. Produce requirements and a short plan.
5. Add or update validation for preserved behavior, new behavior, invariants, and public contracts.
6. Implement in small, reviewable steps.
7. Validate with local project commands.
8. Summarize what changed, what you validated, what you did not validate, and the remaining risks.

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
- you explained the change clearly for review
