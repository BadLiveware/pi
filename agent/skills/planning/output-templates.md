# Planning Output Templates

Use these templates when `planning/SKILL.md` requires a concrete plan artifact. Replace every placeholder before publishing or handing off; unresolved placeholders mean the plan is not ready.

## Split Plan Directory Template

Use this layout when a bounded change needs a durable semantic specification plus a separate implementation decomposition. Planning files split responsibilities, not delivery: use `prs/` only when the user explicitly requests multiple PRs.

```text
.pi/plans/<plan-name>/
├── README.md                    # semantic contract: behavior, invariants, scope
├── work-breakdown.md            # implementation nodes, dependencies, ownership, validation
├── docs/                        # reusable runbooks, validation workflows, compatibility maps
│   ├── tooling-and-validation.md
│   └── <reference-topic>.md
├── work/                        # optional deeper implementation context; not ordering authority
│   └── <context-topic>.md
└── design/                      # deferred or cross-cutting design decisions
    └── <decision-topic>.md
```

Do not add `work/` files merely to mirror nodes. Add them only when a node needs context that would overload `work-breakdown.md`. Use `prs/` only for an explicitly requested multi-PR delivery workflow.

### `README.md` semantic contract

````md
# <Topic>

## Purpose
<why this behavior or capability matters>

## Domain model and terminology
- **<concept>**: <meaning in this change>
- **<concept>**: <meaning and relationship to other concepts>

## Current semantics
<observable behavior today, including evidence or examples when useful>

## Desired semantics
<observable behavior after completion, stated independently of files, phases, workers, or tools>

### Representative examples
| Situation | Required behavior |
| --- | --- |
| <input/state> | <observable result> |
| <edge case> | <observable result> |

## Invariants
- <rule that must remain true across implementations>
- <compatibility, safety, data, or lifecycle invariant>

## Scope
In scope:
- <semantic behavior included>

Out of scope:
- <nearby behavior intentionally unchanged>

## Compatibility and migration expectations
- <public contract, persisted-data, rollout, or backward-compatibility expectation>

## Decisions and open questions
- Decision: <settled semantic or architectural boundary>
- Open question: <question that must be resolved before affected work executes, or none>

## Supporting material
- [`work-breakdown.md`](work-breakdown.md) — implementation decomposition and validation mapping
- [`design/<decision-topic>.md`](design/<decision-topic>.md) — supporting rationale, if needed
- [`docs/<reference-topic>.md`](docs/<reference-topic>.md) — reusable operational or compatibility reference, if needed

## Whole-change acceptance
- [ ] <observable semantic outcome>
- [ ] <invariant or compatibility condition>
- [ ] <known deferred behavior is explicitly excluded>
````

Do not put node order, file ownership, worker instructions, retry limits, branch/PR mechanics, or command lists in this README. Those belong in `work-breakdown.md` or reusable runbooks.

### `work-breakdown.md` implementation contract

```md
# <Topic> work breakdown

This file decomposes the semantic contract in [`README.md`](README.md) into executable work. README owns behavioral meaning; this file owns topology, implementation responsibility, and validation mapping.

## Whole-change implementation constraints
- <compatibility, safety, performance, migration, approval, or artifact constraint>
- Final combined-result validation: `<exact command>`

## Topology summary
| Node | Depends on | Implements | Owned writes/resources |
| --- | --- | --- | --- |
| `<contract>` | — | [`README § Invariants`](README.md#invariants) | `<paths/resources>` |
| `<leaf-a>` | `<contract>` | [`README § Desired semantics`](README.md#desired-semantics) | `<disjoint paths/resources>` |
| `<leaf-b>` | `<contract>` | [`README § Compatibility`](README.md#compatibility-and-migration-expectations) | `<disjoint paths/resources>` |

Derive nodes from executable dependencies and ownership, not README headings or planning-file boundaries. One node may implement several semantic requirements, and one semantic requirement may need several nodes.

## Complete node contracts

### `<node-id>`
- Objective: <bounded report, research, test, decision, implementation, or promotion outcome>
- Supports: [`README § <semantic section>`](README.md#<anchor>)
- Task: <complete execution instruction>
- Depends on: <node ids or none>
- Acceptance criteria:
  - <node-level observable pass condition>
- Reads/context: `<paths or supporting plan files, or none>`
- Owned writes: `<disjoint paths or none>`
- Resource claims: <shared/exclusive claims or none>
- Validation: `<exact command or none>`
- Max attempts: <positive integer; advisory>

<repeat for every node>

## Execution rules
- For a compact DAG, submit the complete node set with the default one-shot `stardock_plan` action. For a large DAG, create a draft, upsert bounded node groups, then seal it.
- Authoring groups are context-loading units, not execution boundaries. Dependency edges in the sealed graph determine prerequisite behavior.
- Run the complete ready antichain; do not serialize independent leaves.
- Review settled evidence in governor-owned batches; accepted reports unlock dependents without mandatory integration.
- Model promotion, integration, combined validation, delivery, or release as explicit dependent nodes when the requested work requires them.
- Treat failed checks, no-edit outcomes, and attempt exhaustion as governor decision evidence rather than semantic workflow gates.
- Treat nodes as arbitrary jobs, not README sections, planning files, PRs, branches, or mandatory code producers.

## Delivery workflow
<Only include when delivery requires explicit sequencing outside ordinary integration, such as a user-requested multi-PR workflow.>
```

Keep this file compact but complete enough to execute. Link deeper implementation context instead of duplicating it, and reference README sections instead of restating semantics.

### Optional implementation context file

````md
# <Implementation Context Topic>

## Used by
- [`../work-breakdown.md § <node-id>`](../work-breakdown.md#<node-anchor>)

## Purpose
<implementation detail that would overload the compact node contract>

## Affected areas
- `<path or subsystem>`
- `<path or subsystem>`

## Current implementation evidence
- <verified fact, location, or behavior>

## Required approach or constraints
- <algorithm, migration detail, compatibility constraint, or pitfall>

## Supporting references
- [`../docs/<runbook>.md`](../docs/<runbook>.md)
- [`../design/<decision>.md`](../design/<decision>.md)

## Open implementation questions
- <bounded question and how the node should resolve it, or none>
````

Do not repeat node ordering, acceptance criteria, or validation here. `work-breakdown.md` remains the implementation contract.

### Reference doc / runbook

```md
# <Reference Topic>

## Purpose
<what execution nodes should use this for>

## Facts / constraints
- <durable fact, observed evidence, or external rule>

## Procedure
1. <exact command or inspection>
2. <expected signal>

## Use from execution nodes
- Referenced by: [`../work-breakdown.md § <node-id>`](../work-breakdown.md#<node-anchor>)
- Do not add mandatory execution jobs here; keep them in `work-breakdown.md`.
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

## Implementation relationship
- Enables or informs: [`../work-breakdown.md § <node-id>`](../work-breakdown.md#<node-anchor>)
- Do not start implementation from this note until `work-breakdown.md` names the accepted boundary.
```

## Simple Single-File Plan Template

Use for bounded work small enough that semantic meaning and implementation decomposition remain easy to distinguish in one document.

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

## Work breakdown

The sections above remain the semantic contract; the nodes below describe implementation.

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
