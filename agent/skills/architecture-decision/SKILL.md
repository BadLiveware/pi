---
name: architecture-decision
description: Use when designing a new subsystem or making/revisiting large structural decisions: module/service boundaries, APIs, protocols, storage/data models, state ownership, concurrency/queueing, extension points, migrations, public contracts, major abstractions, or cross-cutting operational/security/performance choices. Do not use for routine implementation inside an established architecture.
---

# Architecture Decision

Use this skill to choose the system shape before sequencing implementation. The outcome is a clear decision, or a deliberately narrowed set of options, with constraints, tradeoffs, risks, and validation evidence.

## When to Use
- You are designing a new subsystem, service, extension, protocol, storage layer, data model, API, worker/queue model, or plugin boundary.
- You are rethinking an existing architecture because requirements changed or the current shape causes repeated friction, scale limits, reliability issues, security risk, or testability problems.
- You must choose between materially different designs, frameworks, abstractions, ownership boundaries, migration paths, or public contracts.
- The choice affects compatibility, persisted data, rollout/rollback, operability, security, performance, or long-term maintainability.

## When Not to Use
- The work is a bug fix, local feature, or small refactor that fits an established pattern.
- The architecture decision has already been made and the next job is task sequencing; use `planning` or `execute-plan`.
- A simple implementation inside current boundaries is sufficient; do not invent abstractions to make the work feel architectural.

## Workflow
1. State the decision being made, desired behavior, non-goals, assumptions, constraints, and public contracts.
2. If redesigning, inspect the current architecture, invariants, data ownership, dependency direction, failure model, and migration constraints before proposing replacements.
3. Identify the forces that matter: correctness, state ownership, compatibility, testability, performance cost shape, reliability, security, observability, operability, and repo/team conventions.
4. List viable options, including the status quo, the simplest local change, and no-new-abstraction when those are credible.
5. Compare options by tradeoff, not preference: what each improves, what it makes harder, what it risks, and what evidence would change the choice.
6. Choose the smallest adequate architecture and define its boundaries, contracts, invariants, data flow, failure states, and ownership.
7. Define proof points before implementation: tests, prototypes, benchmarks, migrations, rollout/rollback checks, compatibility checks, or observability signals.
8. Hand off to `planning` with concrete implementation boundaries and validation once the architecture decision is stable.

## Output Shape
For non-trivial decisions, produce a compact ADR-style summary:

```md
Decision:
Context and constraints:
Options considered:
Chosen shape:
Boundaries, contracts, and invariants:
Tradeoffs and risks:
Validation, rollout, and rollback:
Implementation handoff:
```

If the right architecture cannot be chosen from current evidence, stop with the missing evidence and the smallest discovery task that would unblock the decision.

## Common Failure Modes
- Sequencing implementation tasks before deciding ownership, contracts, state, and migration boundaries.
- Preserving accidental current behavior as compatibility, or breaking real compatibility because it was not identified.
- Adding a framework, service, cache, queue, or abstraction before the simpler shape has been ruled out.
- Ignoring operational realities: deployment, credentials, observability, retries, data repair, rollback, or failure recovery.
- Treating performance as a late benchmark only; name scaling variables and bounds while choosing the architecture.
