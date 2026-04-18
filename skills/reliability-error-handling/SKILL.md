---
name: reliability-error-handling
description: Improves correctness and robustness through explicit null handling, result-based error modeling, state clarity, and user-understandable failure reporting.
---

# Reliability and Error Handling

Use this skill when designing or changing code paths where correctness, state modeling, and failure handling matter.

## Goals
- Make invalid states harder to represent
- Handle absence and failure explicitly
- Avoid hidden control flow
- Surface understandable failures at system boundaries

## Principles
### Correct by construction
Prefer language-native or project-standard mechanisms for:
- nullable / optional values to represent absence explicitly
- result objects or typed outcomes to represent success vs failure
- union / sum types to model distinct states

### Error handling
- Avoid exceptions for routine control flow.
- Return explicit outcomes that the caller must handle.
- Preserve enough detail for debugging and logging.
- Convert low-level failures into user-understandable errors at the boundary.

### Caller responsibility
- Require the caller to handle meaningful failure states.
- Keep error variants intentional and named.
- Cover expected failure paths in tests.

## Review Checklist
- Is absence modeled explicitly?
- Are failure states distinguishable?
- Is the happy path separated cleanly from failure handling?
- Does the user-facing interface receive understandable errors?
- Are exceptions reserved for truly exceptional circumstances?
