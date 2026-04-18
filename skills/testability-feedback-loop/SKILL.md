---
name: testability-feedback-loop
description: Applies TDD and feedback-loop oriented development by improving testability, adding controlled interfaces, and validating behavior continuously during implementation.
---

# Testability Feedback Loop

Use this skill when implementing or refactoring behavior that should be validated incrementally rather than by inspection alone.

## Goals
- Create fast feedback during development
- Make systems easy to test in isolation
- Improve confidence in behavioral changes
- Support controlled, deterministic tests

## Core Practices
- Write or update tests early.
- Capture both current and desired behavior.
- Protect invariants with focused tests.
- Favor deterministic test doubles over brittle integration-heavy setups when unit-level confidence is needed.

## Design Guidance
### Generalized components
- Prefer reusable components when they help isolate domain behavior.
- Keep domain logic simple by hiding low-level mechanisms behind stable abstractions.

### Interfaces and doubles
When useful, define interfaces with:
- static/fake implementations for deterministic tests
- dynamic/real implementations for production behavior
- explicit step control when tests need to release data or behavior in a precise sequence

### Observability
- Add internal observability where it improves test confidence or debugging.
- Support out-of-process introspection when behavior spans components or runtime boundaries.

## Workflow
1. Define what behavior must be preserved.
2. Add tests for existing behavior if missing.
3. Add tests for intended behavior and invariants.
4. Introduce interfaces or seams if the code is hard to test.
5. Implement in small increments.
6. Re-run tests after each meaningful step.

## Output Template

```md
## Test Strategy
- Existing behavior tests:
- New behavior tests:
- Invariants:
- Test doubles / seams needed:
```
