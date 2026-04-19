---
name: reliability-error-handling
description: Use when changes affect failure handling, nullable or optional state, state transitions, compatibility, or user-facing errors on correctness-sensitive paths.
---

# Reliability and Error Handling

Use this skill to make state, absence, and failures explicit.

## Reach for This Skill When
- nullable or optional state is spreading through the design
- failure paths are implicit, exception-driven, or hard to reason about
- compatibility or user-facing error behavior is changing

## Outcome
- explicit state and failure modeling with clearer caller responsibilities and more understandable boundary behavior

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

### Compatibility and safety
- Consider compatibility expectations for APIs, protocols, CLI output, configuration, or data models.
- Plan for migrations, rollback, or destructive changes when relevant.
- Validate inputs, respect authentication/authorization boundaries, and protect secrets and sensitive data.

## Review Checklist
- Is absence modeled explicitly?
- Are failure states distinguishable?
- Is the happy path separated cleanly from failure handling?
- Does the user-facing interface receive understandable errors?
- Are exceptions reserved for truly exceptional circumstances?
- Have compatibility, migration, rollback, and security concerns been considered where relevant?
