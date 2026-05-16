---
name: excession-behavior-modeling
description: Use when code or design work has nontrivial fundamental behavior risks such as cost/bounds, resource lifecycle, state/protocol invariants, concurrency/interleavings, progress/liveness, data-shape drift, or effect/idempotency boundaries.
---

# Excession Behavior Modeling

Use Excession as a small proof-oriented behavior-model lane for one risky question. The expected outcome is a focused `.exm` model plus validated analyzer evidence that clarifies a fundamental behavior property before, during, or after implementation.

## Reach for This Skill When
- a task changes or reviews behavior where a hidden property could be wrong: loops, scans, retries, queues, background work, cancellation, locks, state machines, paired data structures, resource cleanup, or side effects
- the user asks to model, sanity-check, or prove behavior with Excession or `.exm`
- an architecture or design choice depends on cost growth, resource ownership, protocol/state invariants, interleavings, progress/liveness, data-shape consistency, or idempotency/effect boundaries
- a code review has one of those behavior-risk families and a small model would produce clearer evidence than prose alone

## Do Not Use It For
- routine edits, docs-only changes, style fixes, renames, or simple refactors with no behavior-risk question
- broad automatic source review, general linting, security scanning, numeric correctness, or compatibility/API review unless the concern is explicitly one of Excession's core behavior families
- replacing project-native tests, typecheckers, linters, benchmarks, code-intel, or normal review evidence
- source-wide analysis when you cannot state a specific behavior question first
- speculative warnings: Excession output is evidence to verify, not permission to surface maybes

## Workflow
1. State the behavior question in one sentence, including the property to check and the path/scope it applies to.
2. Call the Excession model-guide tool for the relevant topic(s), such as `cost`, `resource`, `protocol`, `concurrency`, `progress`, `data-shape`, `effects`, or `invariants`. In pi these MCP tools may appear with an `excession_excession_*` prefix. On follow-up guide calls, exclude topics you already read.
3. Write the smallest `.exm` model that captures the intended behavior. Prefer model-only analysis first; add source conformance only when a narrow source-vs-model question is useful.
4. Persist the draft with the Excession write-model tool. Treat the returned `modelPath` as the handoff artifact.
5. Validate the model before analysis. Fix parse/lowering diagnostics in the model rather than interpreting them as code findings.
6. Run only the relevant lane(s) first. Use proof reports when asking about cost growth or invariant correctness.
7. Interpret the result carefully:
   - surfaced findings need a checkable argument, evidence, assumptions, and verification context
   - diagnostics describe analyzer/model/tooling status, not code defects
   - discoveries or summaries are useful facts, not findings
8. Verify any retained source or model anchor against the current repo before changing code or reporting the issue.
9. Still run the project-appropriate validation for the actual change. Excession augments the feedback loop; it does not replace tests or review.

## Reporting
When Excession materially affected the work, summarize:
- the behavior question and model path
- lanes or proof questions run
- findings, diagnostics, or discoveries that changed your decision
- validation that still came from project-native commands

If this skill was triggered but you skipped Excession, state the concrete reason, such as no specific modelable behavior question, unavailable MCP tooling, or a cheaper project-native check that directly covered the risk.

## Boundaries
- Writing, validating, and running a model are separate tool calls; do not imply one completed the others.
- Keep generated scratch models under the tool-managed `.excession/` area unless the user asks for a durable model file.
- Do not modify the Excession implementation repository or docs just because you are using the tool. Only inspect or edit that repository when the task is about Excession itself or the MCP integration is failing.
