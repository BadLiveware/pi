---
name: implementation-planning
description: Use when work is large, risky, or multi-step enough that you should sequence changes, validation, and any preparatory refactors before editing code.
---

# Implementation Planning

Use this skill to turn explicit requirements into small validated steps before editing code.

## Reach for This Skill When
- work is large, risky, or multi-step
- refactors may need to be separated from behavior changes
- validation needs to be planned before implementation starts

## Outcome
- a stepwise plan with validation, risks, and rollback points

## Workflow
1. Start from explicit requirements, non-goals, and assumptions.
2. Identify affected areas of the codebase, local constraints, public contracts, generated artifacts, and project-sanctioned validation commands.
3. Break the work into steps that can be validated independently.
4. Separate:
   - preparatory refactors
   - behavior changes
   - follow-up cleanup
5. Define validation for each step using a validation ladder:
   - focused inner-loop checks
   - broader integration/manual/benchmark validation
   - validation that cannot currently be run
6. Call out risks, rollback points, and side effects.

## Planning Principles
- Prefer the smallest coherent steps over broad rewrites.
- Introduce abstractions only when they improve domain clarity, testability, or reuse.
- Preserve behavior with focused validation before restructuring.
- Prefer project-sanctioned commands over generic defaults.

## Output Template

```md
## Plan
1. ...
2. ...

## Validation
- ...

## Risks
- ...
```
