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
- scope-appropriate alignment: no ceremony for obvious scoped changes, no skipped alignment for ambiguous or multi-path work
- an evidence note when Feynman research is needed before assumptions are safe

## Scope Triage
Before asking questions, classify the request:

- **Trivial/scoped:** the implementation path is obvious, risk is low, and assumptions do not materially affect behavior. State assumptions briefly and proceed.
- **Ambiguous:** assumptions would change behavior, UX, public contracts, data safety, architecture, or operational risk. Ask targeted questions one at a time.
- **Multi-path:** several viable approaches have meaningful tradeoffs. Present 2-3 options, recommend one, and ask for alignment.
- **Broad/product/design-heavy:** user goal, success criteria, non-goals, and boundaries are not stable. Align on purpose and desired outcome before implementation planning.

Do not turn limited/scoped changes into a design ceremony. Do not skip alignment when the requested mechanism may not serve the user's actual goal.

Urgency is not permission to guess. If the user says "just do it", "quick fix", or asks to avoid questions, proceed only when assumptions are low-risk; otherwise ask the smallest targeted question or state the risky assumption and get alignment before changing behavior, data safety, architecture, UX, or public contracts.

## Workflow
1. Inspect relevant code and local project instructions first.
2. Restate the task in plain language, distinguishing the user's requested mechanism from the underlying goal when they differ.
3. Triage scope using the categories above.
4. Identify gaps: missing inputs, unclear constraints, ambiguous behavior, codebase mismatches, contract concerns, evidence gaps, or environment constraints.
5. When evidence gaps materially affect scope, use focused Feynman research before locking assumptions: `session-search` for prior work, `alpha-research` or `literature-review` for papers, `source-comparison` for competing approaches, and `deep-research` for a sourced brief.
6. Ask targeted questions when assumptions would materially affect behavior, architecture, data safety, or user experience. Prefer one precise question at a time; use multiple-choice options when that reduces effort for the user.
7. If low-risk assumptions are enough to proceed, state them explicitly and continue without asking for approval.
8. For multi-path work, present 2-3 approaches with tradeoffs and a recommendation before planning or implementation.
9. Produce a compact requirements list covering:
   - current behavior
   - desired behavior
   - invariants / must-not-break behavior
   - non-functional concerns
   - non-goals / scope boundaries
10. Confirm assumptions before substantial implementation when the scope is ambiguous, multi-path, broad, risky, or user-facing.

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
