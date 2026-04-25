---
name: requirements-discovery
description: Use when a request is ambiguous, incomplete, contradictory, unusually broad, or likely to mean different things under different assumptions.
---

# Requirements Discovery

Use this skill to align on the problem before implementation.

## Reach for This Skill When
- the request is ambiguous, incomplete, contradictory, or broad
- codebase reality conflicts with the request
- different assumptions would lead to different implementations
- the right requirements depend on prior work, external evidence, papers, or comparing approaches

## Outcome
- a compact statement of understanding, requirements, non-goals, assumptions, and risks
- an evidence note when Feynman research is needed before assumptions are safe

## Workflow
1. Inspect relevant code and local project instructions first.
2. Restate the task in plain language.
3. Identify gaps: missing inputs, unclear constraints, ambiguous behavior, codebase mismatches, contract concerns, evidence gaps, or environment constraints.
4. When evidence gaps materially affect scope, use focused Feynman research before locking assumptions: `session-search` for prior work, `alpha-research` or `literature-review` for papers, `source-comparison` for competing approaches, and `deep-research` for a sourced brief.
5. Ask targeted questions when assumptions would materially affect behavior, architecture, data safety, or user experience.
6. If low-risk assumptions are enough to proceed, state them explicitly.
7. Produce a compact requirements list covering:
   - current behavior
   - desired behavior
   - invariants / must-not-break behavior
   - non-functional concerns
   - non-goals / scope boundaries
8. Confirm assumptions before substantial implementation.

## Output Template

```md
## Understanding
- ...

## Requirements
- ...

## Non-goals
- ...

## Assumptions
- ...

## Risks / Unknowns
- ...
```

## Guidance
- Prefer a small number of precise questions over a long questionnaire.
- Treat local conventions, generated-artifact flows, and public contracts as part of the requirements.
- If the request conflicts with the codebase or local project instructions, say so clearly and ask for direction.
