---
name: architecture-decision
description: Use when designing a new subsystem or making/revisiting large structural decisions: module/service boundaries, APIs, protocols, storage/data models, state ownership, concurrency/queueing, extension points, migrations, public contracts, major abstractions, or cross-cutting operational/security/performance choices. Do not use for routine implementation inside an established architecture.
---

# Architecture Decision

Use this skill to choose the system shape before sequencing implementation. The outcome is a clear decision, or a deliberately narrowed set of options, with constraints, tradeoffs, risks, and validation evidence.

Default to using this as an internal design checkpoint. Do not return an architecture document just because this skill applies; surface only the decision, key tradeoff, blocker, or short plan the user needs.

Start with the data/state shape: what exists, who owns it, what invariants hold, what the common path should make easy, and which special cases disappear if the shape is right.

Respect real ownership, but do not worship accidental boundaries. Identify what must remain compatible and what adjacent boundary could change to remove local complexity.

Optimize for maintainers as well as machines: make boundaries, dependencies, and operational behavior explicit enough that the common change can be understood safely.

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
2. If redesigning, inspect the current architecture, invariants, data ownership, dependency direction, failure model, migration constraints, and evidence such as co-change patterns, ownership friction, debugging pain, onboarding confusion, or incident history before proposing replacements.
3. State the data/state shape before comparing solutions: entities, relationships, source of truth, readers/writers, invariant owners, common path, and special cases the shape should eliminate.
4. Identify ownership and change authority in both directions: what cannot change without compatibility, migration, rollout, or approval, and what adjacent boundary could change to make the solution simpler.
5. Ask whether local complexity means the problem is being solved at the wrong boundary: producer vs consumer, storage model vs adapter, API vs caller, validation layer vs workaround, or runtime/operational boundary vs application code.
6. Identify the forces that matter: comprehension/cognitive load, correctness, state ownership, compatibility, testability, performance cost shape, reliability, security, observability, operability, and repo/team conventions.
7. List viable options, including the status quo, the simplest local change, an adjacent-boundary change, and no-new-abstraction when those are credible.
8. Compare options by tradeoff, not preference: what each improves, what it makes harder, what it risks, and what evidence would change the choice.
9. Choose the simplest deployable architecture that preserves future options and define its boundaries, contracts, invariants, data flow, failure states, and ownership.
10. Define proof points before implementation: tests, prototypes, benchmarks, migrations, rollout/rollback checks, compatibility checks, or observability signals. For async, distributed, cached, or event-driven designs, include observability, idempotency, retries, consistency, and failure analysis as architectural proof points, not follow-up operations work.
11. Hand off to `planning` with concrete implementation boundaries and validation once the architecture decision is stable.

## Minimum Decision Checklist
Before recommending or implementing an architecture, answer these directly, even if only in your internal reasoning:

- **Data/state:** What entities exist, where is the source of truth, who reads/writes, and who owns invariants?
- **Ownership:** What can this change modify freely, what must remain compatible, and what needs migration, rollout, or approval?
- **Boundary:** Is the simplest solution local, or does complexity indicate an adjacent boundary should change?
- **Comprehension:** What must a maintainer understand to change this safely, and which hidden dependencies or mental context does the design remove?
- **Performance shape:** What work scales with files, rows, requests, events, bytes, dependencies, tenants, users, or time; what bounds or cancels it; and which architecture choice changes that cost?
- **Options:** Compare at least the status quo, simplest local change, adjacent-boundary change, and no-new-abstraction option when credible. Escalate to distributed, event-driven, or strict DDD-style structures only for concrete scaling, ownership, reliability, regulatory, or domain-complexity needs.
- **Decision:** State the chosen shape and why rejected options are worse under current constraints.
- **Proof:** Name the tests, prototype, benchmark, migration check, rollout/rollback check, or compatibility check that would validate the choice.
- **Handoff:** Identify implementation boundaries and what should not be revisited during normal planning unless new evidence appears.

## Visibility and Output
Use the checklist to avoid rewrites after review; do not force the user to read an ADR for ordinary implementation work. Keep the architecture reasoning concise or internal unless the user asks for it, the decision is high-risk, approval is needed, or implementation would otherwise be hard to review.

For non-trivial visible decisions, produce a compact ADR-style summary:

```md
Decision:
Context and constraints:
Data/state shape:
Ownership and change authority:
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
- Choosing code structure before understanding data/state shape, ownership, invariants, and common-case flow.
- Treating every touched file or behavior as freely changeable instead of identifying real ownership, generated sources, public contracts, and downstream users.
- Treating the first touched layer as fixed and piling on local complexity instead of considering a simpler change at the real ownership boundary.
- Preserving accidental current behavior as compatibility, or breaking real compatibility because it was not identified.
- Adding a framework, service, cache, queue, or abstraction before the simpler shape has been ruled out.
- Ignoring operational realities: deployment, credentials, observability, idempotency, retries, data repair, rollback, or failure recovery.
- Treating performance as a late benchmark only; name scaling variables and bounds while choosing the architecture.
