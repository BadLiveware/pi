---
name: testability-feedback-loop
description: Use when tests are slow, flaky, hard to isolate, or missing, and you need fast feedback while changing behavior.
---

# Testability Feedback Loop

Use this skill to build a fast validation loop while changing behavior.

## Reach for This Skill When
- tests are slow, flaky, missing, or hard to isolate
- you need seams, doubles, or observability to validate behavior
- inspection alone is not enough to trust the change

## Outcome
- a fast validation loop with focused checks, useful seams, explicit coverage of preserved behavior and invariants, and enough confidence to finish the real change instead of punting it

## Core Practices
- Write or update tests early.
- For bug fixes, prefer RED -> GREEN -> REFACTOR: capture the failing behavior first, then fix it, then clean up.
- Capture both current and desired behavior.
- Protect invariants with focused validation.
- Prefer deterministic doubles over brittle integration-heavy setups when unit-level confidence is needed.
- Use the fastest relevant checks in the inner loop and broader validation at milestones.
- Prefer project-sanctioned commands over generic defaults.

## Design Guidance
- Keep domain logic simple by hiding low-level mechanisms behind stable abstractions.
- Introduce seams when the code is hard to test.
- Use fake/static implementations and explicit step control when tests need deterministic sequencing.
- Add observability where it improves debugging or test confidence.
- Avoid abstraction that does not improve clarity, testability, or reuse.

## Workflow
1. Define what behavior and public contracts must be preserved.
2. For bug fixes, first add the smallest focused failing test or equivalent executable check that proves the current bug when practical.
3. Add tests for existing behavior if missing.
4. Add tests or other focused validation for intended behavior and invariants.
5. Introduce interfaces, seams, or observability if needed.
6. Use that tighter loop to finish the requested behavior, not just the scaffolding, unless a real blocker remains.
7. Re-run the fastest relevant validation after each meaningful step and broader checks at milestones.
8. If a failing test first is genuinely impractical, report the reason and the substitute evidence used instead.
9. Report what was validated, what could not be validated, and any remaining risk.

## Output Template

```md
## Validation Strategy
- Existing behavior tests:
- New behavior tests:
- Invariants:
- Test doubles / seams needed:
- Broader validation:
- Unavailable validation:
```
