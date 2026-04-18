---
name: requirements-discovery
description: Clarifies ambiguous requests, extracts real user intent, and turns tasks into explicit requirements, assumptions, constraints, and success criteria before implementation.
---

# Requirements Discovery

Use this skill when the request is ambiguous, incomplete, contradictory, or large enough that implementation should not begin immediately.

## Goals
- Understand what the user is truly trying to accomplish
- Detect missing context, contradictions, and unstated assumptions
- Translate the request into concrete requirements
- Align on success criteria before code changes begin

## Workflow
1. Inspect the relevant code or files first.
2. Restate the task in plain language.
3. Identify gaps:
   - missing inputs
   - unclear constraints
   - ambiguous desired behavior
   - mismatches between request and codebase reality
4. Ask targeted clarifying questions if needed.
5. Produce a compact requirements list:
   - current behavior
   - desired behavior
   - invariants / must-not-break behavior
   - non-functional concerns
6. Confirm assumptions before substantial implementation.

## Output Template

```md
## Understanding
- ...

## Requirements
- ...

## Assumptions
- ...

## Risks / Unknowns
- ...
```

## Guidance
- Prefer a small number of precise questions over a long questionnaire.
- If the request is implementable with reasonable assumptions, state those assumptions explicitly.
- If the request conflicts with the codebase, say so clearly and ask for direction.
