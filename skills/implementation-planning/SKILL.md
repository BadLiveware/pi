---
name: implementation-planning
description: Converts requirements into a reviewable implementation plan with sequencing, risks, validation steps, and clear boundaries before coding starts.
---

# Implementation Planning

Use this skill for non-trivial changes that benefit from explicit sequencing before editing code.

## Goals
- Plan the work before making changes
- Keep implementation incremental and reviewable
- Identify validation steps early
- Separate preparatory refactors from feature work when appropriate

## Workflow
1. Start from explicit requirements.
2. Identify affected areas of the codebase.
3. Break the work into steps that can be validated independently.
4. Separate:
   - preparatory refactor work
   - behavior changes
   - follow-up cleanup
5. List validation for each step:
   - tests
   - benchmarks
   - manual verification
6. Call out risks and rollback points.

## Planning Principles
- Prefer small, coherent steps over broad rewrites.
- Introduce general components only when they simplify domain logic or improve reuse.
- Encapsulate low-level complexity behind stable interfaces.
- Preserve behavior with tests before restructuring.

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
