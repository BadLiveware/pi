# Planning Output Templates

Use these templates when `planning/SKILL.md` requires a concrete plan artifact. Replace every `...` placeholder before publishing or handing off; unresolved placeholders mean the plan is not ready.

## Split Plan Layout

```text
.pi/plans/<plan-name>/
├── README.md
├── 01-<slice>.md
├── 02-<slice>.md
└── 03-<slice>.md
```

`README.md`:

````md
# <Topic> implementation plan

## Purpose
...

## Desired end state
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

## Cross-cutting risks and rollback
- ...

## Cross-cutting validation
- `<command or inspection>` -> expected signal

## Final acceptance criteria
- [ ] ...
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
- [ ] Task with acceptance criteria and affected files

## Validation tasks
- [ ] `<command or inspection>` -> expected signal

## Compatibility / docs / cleanup
- [ ] ...

## Exit criteria
- [ ] ...

## Handoff to next file
- ...
```

## Single Plan Template

```md
# <Topic> plan

## Purpose
...

## Scope
- In: ...
- Out: ...

## Requirements and constraints
- ...

## Current behavior / evidence
- ...

## Desired behavior
- ...

## Risks and rollback
- ...

## Plan

### <Group 1>
- Goal / scope: ...
- Code areas: ...

#### Task: <name>
- Goal: ...
- Files / areas: ...
- Acceptance criteria:
  - [ ] ...
- Validation: `<command or inspection>` -> expected signal
- Risks / notes: ...
- Delegation: ...

### <Group 2>
...

## Validation summary
- Focused checks: ...
- Broader checks: ...
- Gaps / unavailable dependencies: ...

## Handoff / execution notes
- Use `execute-plan` or `execute-long-plan`: ...
```

## Artifact Hygiene Examples
Prefer domain-facing names:
- `Add planner support for scalar subqueries in SELECT`
- `ClickHouse deployment profile validation`

Avoid plan labels in artifacts:
- `Implement phase 2`
- `phase2Planner`
- `Stage 05 docs`
