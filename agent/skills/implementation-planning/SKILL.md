---
name: implementation-planning
description: Use when work is large, risky, or multi-step enough that you should sequence changes, validation, and any preparatory refactors before editing code.
---

# Implementation Planning

Use this skill to turn explicit requirements into a validated plan before editing code. If the plan is already clear and the next job is to start executing it through tasks, switch to `execute-plan`.

## Reach for This Skill When
- work is large, risky, or multi-step
- refactors should be separated from behavior changes
- validation needs design before implementation starts
- scope, sequencing, or dependencies are still unclear
- task tracking or bounded delegation would help

## Outcome
- a clear plan with ordered phases/tasks, validation, and risks
- plan sections that include both context and executable tasks
- a task list that mirrors the plan when task tools are available
- identified delegation points for bounded leaf work
- planned comment/documentation work for non-obvious or compatibility-driven code

## Workflow
1. Capture requirements, non-goals, assumptions, constraints, and public contract concerns.
2. Identify affected code, generated artifacts, local constraints, and project-sanctioned validation commands.
3. If working from an existing plan, isolate the current referenced phase/document and its immediate prerequisites.
4. Break the work into independently validatable steps and order refactors, behavior changes, delegation, and cleanup.
5. Call out risks, rollback points, side effects, and any code likely to need targeted comments.
6. Choose domain-facing names early; do not carry plan labels into code.
7. If writing a plan document, give each major phase/group concrete nested tasks rather than context-only prose.
8. If task tools are available, create tasks that mirror the plan and add dependencies that match the intended order.
9. Keep the plan and task list aligned as work evolves.
10. Judge completion against the current plan document's own scope and exit criteria.

## Handoff to Execute Plan
- Use `execute-plan` when the plan is already clear, aligned with the user's request, and the next job is execution.
- Stay in this skill when the plan still needs refinement, sequencing, validation design, risk reduction, or scope clarification.
- If the user asked for planning only, stop at the plan instead of silently switching into implementation.

## Effort Estimates
- Do not include effort estimates, budgets, or time-duration guesses unless the user explicitly asks.
- Prefer concrete scope descriptions: tasks, dependency chains, uncertainty drivers, and validation checkpoints.
- If the user explicitly asks for an estimate, keep it rough, assumption-based, repo-specific, and clearly low-confidence.

## Task Guidance
- Use `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate` proactively for meaningfully multi-step work.
- Read plan files for context, but do not create bookkeeping tasks like `read the plan file` unless review itself is the deliverable.
- Create tasks from concrete implementation steps in the current referenced plan document.
- Use parent/container tasks only for coordination; keep coding, validation, migration, and documentation work in leaf tasks.
- Treat the task list as execution scaffolding, not as the boundary of requested scope; add missing in-scope tasks when needed.
- Avoid vague, catch-all, or bookkeeping-only tasks.
- If future work must be tracked, create concrete deferred tasks in the appropriate later plan document or dependency chain.
- If a step introduces non-obvious logic, compatibility behavior, or required-by-X code, include targeted comment/documentation work in its done state.
- Delegate only bounded, low-coupling leaf tasks. When model choice matters, inspect local pi config first; prefer `gpt-5.3-codex` by default, `gpt-5.4` for difficult work, and `gpt-5.4-mini` or `gpt-5.2-codex` for easy work when available. Avoid local Gemma by default.

## Status and Completion Guidance
- For numbered plans or ordered plan documents, stay on the current referenced document until its mandatory work is complete or the user reprioritizes.
- Answer status questions against that document's own checklist, scope, and exit criteria.
- Do not call scaffolding, observability, or partial groundwork `done` when required implementation work remains.
- Do not report completion just because the initial task list is exhausted if required in-scope work is still missing.

## Examples
### Prefer
- `Add planner support for scalar subqueries in SELECT`
- `Add boundary-case regression tests for range-query subqueries`
- `Phase 2: subquery planner support` as a parent/container task only

### Avoid
- `Implement phase 2`
- `Validate and record incremental progress`
- `Implement the rest`
- code names like `phase2Planner` or `step3Fallback`

## Output Template

```md
## Plan

### Phase 1. <name>
- Goal / scope: ...
- Code areas: ...

#### Task 1. <name>
- Work: ...
- Validation: ...
- Risks / Notes: ...
- Delegation: ...

#### Task 2. <name>
- Work: ...
- Validation: ...
- Risks / Notes: ...

### Phase 2. <name>
- Goal / scope: ...
- Code areas: ...

#### Task 1. <name>
- Work: ...
- Validation: ...
- Risks / Notes: ...

## Cross-cutting Notes
- ...
```
