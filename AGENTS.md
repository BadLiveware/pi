# AGENTS.md

## Purpose

This repository defines overarching guidance for how the agent should approach software development work. The goal is not just to make changes, but to make changes that are understandable, testable, measurable, and easy to review.

## Core Operating Principles

### 1. Understand the real task before changing code
- Start by determining what the user is actually trying to accomplish, not just the literal change they asked for.
- If the request is underspecified, contradictory, or does not match the codebase, ask clarifying questions.
- Restate the problem in concrete terms before implementation when the work is non-trivial.
- Identify constraints, success criteria, and risks up front.

### 2. Turn requests into explicit requirements
Before implementation, derive a small set of requirements that describe:
- current behavior
- desired behavior
- invariants that must not regress
- operational concerns such as performance, observability, and error handling

For larger tasks, present the requirements or implementation plan to the user before making substantial changes.

### 3. Prefer feedback loops over one-shot implementation
Favor workflows that continuously verify correctness:
- write or extend tests early
- create fakes or controlled interfaces where useful
- validate behavior incrementally
- use benchmarks when performance matters
- compare before/after behavior when changing critical paths

### 4. Build testable, composable systems
Prefer designs that separate domain logic from infrastructure details.
- Introduce general, reusable components when they simplify reasoning.
- Encapsulate low-level complexity behind clear interfaces.
- Make components easy to test in isolation.
- Use fake or static implementations when deterministic control improves tests.
- Support observability that enables internal and out-of-process inspection.

### 5. Prefer correctness by construction
Where the language and codebase support it:
- model absence explicitly with nullable/optional types
- model failure explicitly with result types or equivalent patterns
- use unions/sum types to represent distinct states
- avoid implicit invalid states

### 6. Be explicit about errors
- Do not use exceptions for ordinary control flow.
- Surface errors in a form the caller can handle.
- Preserve enough detail for debugging while still presenting user-understandable messages at the boundary.
- Make failure modes visible in tests where possible.

### 7. Measure performance changes instead of guessing
When a change may affect runtime behavior, memory use, or throughput:
- establish a baseline before changing code
- run the same benchmark after the change
- compare revisions directly when possible
- avoid premature micro-optimizations unless they solve a measured problem

### 8. Keep code general where it helps, simple where it matters
- Prefer extensible abstractions when they make domain logic clearer.
- Do not introduce abstraction that only hides simple code without adding leverage.
- Avoid excessive allocations and wasteful work when practical, but do not sacrifice readability without evidence.

## Default Delivery Workflow

For non-trivial work, follow this default sequence:
1. Understand the request and inspect the relevant code.
2. Clarify missing context or state assumptions.
3. Produce requirements and a short implementation plan.
4. Add or update tests for current behavior, desired behavior, and invariants.
5. Implement in small, reviewable steps.
6. Validate with tests, linting, and benchmarks where relevant.
7. Summarize what changed, why, and any remaining risks.

## Testing Guidance
- Prefer TDD or test-first thinking when feasible.
- Verify both the behavior being added and the behavior that must remain unchanged.
- Use deterministic test doubles when timing, sequencing, or external dependencies matter.
- Design interfaces so behavior can be released or controlled step-by-step in tests when needed.

## Reliability and Observability Guidance
- Make important behavior inspectable.
- Add instrumentation where it materially improves debugging or validation.
- Prefer systems that can be reasoned about from logs, metrics, traces, or explicit state transitions.

## Performance Guidance
- Treat benchmarking as part of change validation for hot paths and architectural changes.
- If available, use `badliveware/Benchmark-revision-compare` to compare the target revision against the baseline revision.
- Record what was measured and whether the change preserved, improved, or regressed performance.

## Git and Review Guidance

### Branching
- Work on a branch unless already on an appropriate feature branch.
- Use conventional prefixes:
  - `feat/` for features
  - `fix/` for bug fixes
  - `refactor/` for refactors without feature changes

### Commits
- Commit logical, coherent units of work.
- Prefer commit messages that preserve **why** the change exists.
- Do not over-explain the mechanics when the diff already shows them, unless the implementation is unusually subtle.
- Write messages so a future reader can understand them without hidden context.

### Pull Requests
- Do not claim a PR is open without checking its state.
- If preparatory refactoring is needed, prefer stacked work:
  1. create a refactor branch
  2. open a PR for the refactor
  3. branch feature work from the refactor branch
  4. open a stacked PR targeting the refactor branch

## Subagent Guidance
- Delegate focused, low-coupling tasks to subagents when it improves speed or parallelism.
- Keep delegated tasks concrete and bounded.
- Use appropriate models for the complexity of the delegated work.
- Review subagent output before integrating it into the main line of work.

## Skills in this repository
Use the repository skills when the task matches:
- `requirements-discovery` for clarifying intent and producing concrete requirements
- `implementation-planning` for turning requirements into a stepwise plan
- `testability-feedback-loop` for TDD, testability, observability, and controlled interfaces
- `reliability-error-handling` for result types, nullable handling, invariants, and user-facing failures
- `performance-benchmarking` for before/after performance validation
- `git-and-pr-review` for branch, commit, and PR hygiene
- `subagent-delegation` for splitting work into bounded delegated tasks

## Decision Heuristics
When trade-offs appear:
- choose correctness over speed of implementation
- choose explicitness over hidden behavior
- choose measurable performance over speculative optimization
- choose composability over tightly coupled shortcuts
- choose reviewable increments over large opaque changes

## Definition of Done
A change is done when:
- the problem is clearly understood
- the implementation matches explicit requirements
- relevant tests pass
- performance has been measured if it matters
- errors are handled intentionally
- the change is explained in a way a reviewer can follow
