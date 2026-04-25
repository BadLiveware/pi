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
- a split plan directory with a master overview when the plan would be very long
- a task list that mirrors the plan when task tools are available
- identified delegation points for bounded leaf work
- planned comment/documentation work for non-obvious or compatibility-driven code

## Long Plan Splitting
When a plan is likely to exceed about 800-1000 lines, spans many phases, or would overload execution context, write it as a split plan directory instead of one huge file.

Use this layout by default:

```text
.pi/<topic>-plan/
├── README.md
├── 01-<reviewable-slice>.md
├── 02-<reviewable-slice>.md
└── 03-<reviewable-slice>.md
```

`README.md` is the master plan overview. It must include:
- purpose and desired end state
- execution order with links to numbered plan files
- dependency graph or sequencing notes
- hard constraints carried through all plan files
- cross-cutting risks, compatibility concerns, and rollback notes
- final acceptance criteria across the full split plan
- validation strategy across the full split plan

Each numbered plan file must be independently reviewable and implementation-sized. Aim for roughly 150-350 lines per file when possible. Each file must include:
- local purpose and scope
- prerequisites from earlier files
- affected files or code areas
- concrete implementation tasks
- concrete validation tasks
- compatibility, migration, docs, and cleanup tasks when relevant
- file-local exit criteria
- handoff notes for the next numbered file

Splitting rules:
- Preserve execution order in filenames with zero-padded numeric prefixes.
- Keep each slice coherent: it should leave the repository in a useful state if work pauses after that file.
- Do not split by arbitrary line count alone; split by reviewable implementation boundaries.
- Keep global constraints in `README.md`, and repeat only the file-specific constraints needed to execute safely.
- If an existing umbrella plan exists, link to it from `README.md` and treat the split directory as the execution plan.
- When execution is expected to be long-running, recommend `execute-long-plan` for the handoff.

## Workflow
1. Capture requirements, non-goals, assumptions, constraints, and public contract concerns.
2. Identify affected code, generated artifacts, local constraints, and project-sanctioned validation commands.
3. If working from an existing plan, isolate the current referenced phase/document and its immediate prerequisites.
4. Break the work into independently validatable steps and order refactors, behavior changes, delegation, and cleanup.
5. Call out risks, rollback points, side effects, and any code likely to need targeted comments.
6. Choose domain-facing names early; do not carry plan labels into code.
7. If writing a plan document, first decide whether it should be a normal single document or a split plan directory using Long Plan Splitting.
8. For a single plan document, give each major phase/group concrete nested tasks rather than context-only prose.
9. For a split plan directory, write `README.md` plus ordered numbered plan files, and make each numbered file concrete enough for direct execution.
10. If task tools are available, create tasks that mirror the plan and add dependencies that match the intended order.
11. Keep the plan and task list aligned as work evolves.
12. Judge completion against the current plan document's own scope and exit criteria.

## Handoff to Execute Plan
- Use `execute-plan` when the plan is already clear, aligned with the user's request, and the next job is execution.
- Use `execute-long-plan` when the generated or referenced plan is split across a master `README.md` plus numbered files, is very long, or is likely to require many validation/checkpoint cycles.
- When handing off to execution, carry forward the stop policy: execute through all unblocked in-scope work and do not pause for standalone progress reports after checkpoints, completed phases, successful validation, or `git status`.
- Stay in this skill when the plan still needs refinement, sequencing, validation design, risk reduction, or scope clarification.
- If the user asked for planning only, stop at the plan instead of silently switching into implementation.

## Task Guidance
- Use `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate` proactively for meaningfully multi-step work.
- Read plan files for context, but do not create bookkeeping tasks like `read the plan file` unless review itself is the deliverable.
- Create tasks from concrete implementation steps in the current referenced plan document.
- Use parent/container tasks only for coordination; keep coding, validation, migration, and documentation work in leaf tasks.
- Treat the task list as execution scaffolding, not as the boundary of requested scope; add missing in-scope tasks when needed.
- When context or plan focus changes, reconcile the task list immediately before continuing: keep completed tasks from the current execution round unless they were created in error or clearly replaced/subsumed, delete older completed tasks from irrelevant prior context when they no longer help execute the current scope, and delete or supersede pending tasks that no longer help.
- Do not spend a turn deciding about routine housekeeping. If task cleanup, diff inspection, or similar maintenance helps execute, validate, or review the current scope, do it directly; otherwise skip it.
- Avoid vague, catch-all, or bookkeeping-only tasks.
- If future work must be tracked, create concrete deferred tasks in the appropriate later plan document or dependency chain.
- If a step introduces non-obvious logic, compatibility behavior, or required-by-X code, include targeted comment/documentation work in its done state.
- Delegate only bounded, low-coupling leaf tasks. When model choice matters, inspect local pi config first; prefer `gpt-5.3-codex` by default, `gpt-5.4` for difficult work, and `gpt-5.4-mini` or `gpt-5.2-codex` for easy work when available. Avoid local Gemma by default.

## Status and Completion Guidance
- For numbered plans or ordered plan documents, stay on the current referenced document until its mandatory work is complete or the user reprioritizes.
- Answer status questions against that document's own checklist, scope, and exit criteria.
- Do not call scaffolding, observability, or partial groundwork `done` when required implementation work remains.
- Do not report completion just because the initial task list is exhausted if required in-scope work is still missing.
- During execution, treat progress summaries as internal notes unless the user asked for status only, execution is complete, or a blocker requires a decision.

## Examples
### Prefer
- `Add planner support for scalar subqueries in SELECT`
- `Phase 2: subquery planner support` as a parent/container task only

### Avoid
- `Implement phase 2`
- code names like `phase2Planner` or `step3Fallback`

## Split Plan Output Template

Use this for very long plans.

`README.md`:

````md
# <Topic> implementation plan

## Purpose
...

## Execution order
1. [`01-...md`](01-...md)
2. [`02-...md`](02-...md)

## Dependency graph
```text
01 ... -> 02 ...
```

## Hard constraints
- ...

## Cross-cutting validation
- ...

## Final acceptance criteria
- ...
````

Numbered file:

```md
# <Number>. <Slice Name>

## Purpose and scope
...

## Prerequisites
- ...

## Affected areas
- ...

## Implementation tasks
- [ ] ...

## Validation tasks
- [ ] ...

## Exit criteria
- [ ] ...

## Handoff to next file
- ...
```

## Single Plan Output Template

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
