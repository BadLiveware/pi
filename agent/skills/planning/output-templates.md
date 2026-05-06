# Planning Output Templates

Use these templates when `planning/SKILL.md` requires a concrete plan artifact. Replace every placeholder before publishing or handing off; unresolved placeholders mean the plan is not ready.

## Split Plan Directory Template

Use this layout for broad bounded work, multi-PR/upstreaming efforts, or plans with reusable operational knowledge.

```text
.pi/plans/<plan-name>/
├── README.md
├── stardock-checklist.md        # optional thin runtime wrapper
├── docs/                        # runbooks, validation, maps, reviewer expectations
│   ├── tooling-and-validation.md
│   └── <reference-topic>.md
├── prs/ or slices/              # ordered execution spine
│   ├── 01-<slice>.md
│   ├── 02-<slice>.md
│   └── 03-<slice>.md
└── design/                      # deferred or cross-cutting design notes
    └── <decision-topic>.md
```

Use `prs/` when the execution unit is intended to become a pull request. Use `slices/` for ordinary implementation slices. Keep the directory names domain-facing when another term is clearer.

### `README.md`

````md
# <Topic> plan

## Purpose
<why this work exists and what product/repository outcome it serves>

## Desired end state
<finite completion condition>

## Directory layout
| Area | Purpose |
| --- | --- |
| [`stardock-checklist.md`](stardock-checklist.md) | Thin Stardock checklist wrapper, if used. |
| [`docs/`](docs/) | Durable runbooks, validation workflow, compatibility maps, and reviewer expectations. |
| [`prs/`](prs/) or [`slices/`](slices/) | Ordered execution spine. |
| [`design/`](design/) | Deferred or cross-cutting design notes. |

## Read first
1. [`stardock-checklist.md`](stardock-checklist.md) if using Stardock
2. [`docs/<required-runbook>.md`](docs/<required-runbook>.md)
3. [`docs/<required-map>.md`](docs/<required-map>.md)

## Execution files
| Order | File | Goal |
| ---: | --- | --- |
| 1 | [`prs/01-<slice>.md`](prs/01-<slice>.md) | <reviewable outcome> |
| 2 | [`prs/02-<slice>.md`](prs/02-<slice>.md) | <reviewable outcome> |

## Design notes
- [`design/<decision-topic>.md`](design/<decision-topic>.md)

## Global constraints
- <compatibility, safety, branch, approval, style, migration, performance, or artifact constraint>

## Validation pointer
Use selectors and checks named in each execution file. Shared command wrappers, logs, credentials, or environment setup live in [`docs/<validation-runbook>.md`](docs/<validation-runbook>.md).

## Final acceptance criteria
- [ ] <observable final condition>
- [ ] <validation/reporting condition>
- [ ] <known deferred scope is documented>
````

### `stardock-checklist.md` thin wrapper

```md
# <Topic> Stardock checklist

Execute this plan as bounded slices. This file is the Stardock checklist wrapper; detailed scope and validation stay in the linked execution files.

## Goals
- <top-level outcome>
- <reviewability/validation constraint>

## Stardock use
- Prefer one active Stardock brief per top-level execution item.
- Treat nested checkboxes as the active slice's local done path only when copied from the active execution file.
- If using `stardock_ledger`, promote only the current slice's relevant checks into criteria.
- Keep detailed logs and progress outside this file; link evidence paths in the active brief, ledger artifacts, or progress notes.

## Checklist
- [ ] Complete [`prs/01-<slice>.md`](prs/01-<slice>.md): <goal>
- [ ] Complete [`prs/02-<slice>.md`](prs/02-<slice>.md): <goal>

## Verification
- Before each slice, read the shared runbooks it references.
- Record validation log/artifact paths in Stardock evidence or slice notes.
```

Keep this wrapper intentionally shallow. Do not duplicate the whole execution file tree into it.

### Ordered execution file

````md
# <Order>: <Slice Name>

## Goal
<one reviewable implementation/test/docs outcome>

## Shared scope
In scope:
- <concrete included work>

Out of scope:
- <nearby work to defer or split>

## Affected areas
- `<path or subsystem>`
- `<path or subsystem>`

## Required reference docs
- [`../docs/<runbook>.md`](../docs/<runbook>.md)
- [`../design/<decision>.md`](../design/<decision>.md) if this slice depends on it

## Tasks
1. <ordered task with concrete action and expected result>
2. <ordered task with concrete action and expected result>
3. <ordered task with concrete action and expected result>

## Acceptance criteria
- [ ] <observable pass condition>
- [ ] <tests/docs/config/contracts updated as needed>
- [ ] <slice remains independently reviewable/revertible>

## Validation
```bash
<exact command or inspection>
```

Expected signal: <pass/fail/log/report condition>

## Risks and split triggers
- <risk and mitigation>
- Split before execution if <scope-growth condition>.
````

### Reference doc / runbook

```md
# <Reference Topic>

## Purpose
<what execution files should use this for>

## Facts / constraints
- <durable fact, observed evidence, or external rule>

## Procedure
1. <exact command or inspection>
2. <expected signal>

## Use from execution files
- Referenced by: [`../prs/NN-<slice>.md`](../prs/NN-<slice>.md)
- Do not add mandatory implementation tasks here; put them in the execution spine.
```

### Design note

```md
# <Design Topic>

## Purpose
<decision or investigation kept separate from immediate execution>

## Current decision / status
<accepted, deferred, needs review, blocked>

## Options considered
- <option, tradeoff, evidence>

## Execution relationship
- Enables or informs: [`../prs/NN-<slice>.md`](../prs/NN-<slice>.md)
- Do not start implementation from this note until an execution file names the accepted boundary.
```

## Simple Single-File Plan Template

Use for bounded work that does not need a separate reference library.

```md
# <Topic> plan

## Purpose
<why this work exists>

## Scope
- In: <included work>
- Out: <excluded work>

## Requirements and constraints
- <requirement or constraint>

## Current behavior / evidence
- <observed fact and source>

## Desired behavior
- <desired state>

## Risks and rollback
- <risk, rollback or mitigation>

## Plan

### <Group 1>
- Goal / scope: <coherent outcome>
- Code areas: <paths or subsystems>

#### Task: <name>
- Goal: <what changes>
- Files / areas: <paths or subsystems>
- Acceptance criteria:
  - [ ] <observable pass condition>
- Validation: `<command or inspection>` -> <expected signal>
- Risks / notes: <specific risk or none>
- Delegation: <none or bounded handoff>

### <Group 2>
<repeat as needed>

## Validation summary
- Focused checks: <commands>
- Broader checks: <commands>
- Gaps / unavailable dependencies: <explicit gap or none>

## Handoff / execution notes
- Use `execute-plan`: for split/long bounded plans, read `execute-plan/long-plan.md`; for open-ended loops, read `execute-plan/unbounded-work.md`.
```

## Artifact Hygiene Examples

Prefer domain-facing names:
- `Add planner support for scalar subqueries in SELECT`
- `ClickHouse deployment profile validation`
- `PromQL set-operator compatibility tests`

Avoid plan labels in artifacts:
- `Implement phase 2`
- `phase2Planner`
- `Stage 05 docs`
- `PR 3 helper` unless the artifact is internal PR planning material
