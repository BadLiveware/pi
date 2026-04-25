---
name: requirements-discovery
description: Use when a request is ambiguous, incomplete, contradictory, unusually broad, or likely to mean different things under different assumptions.
---

# Requirements Discovery

Use this skill to align on the real problem before implementation. Remove dangerous ambiguity without turning scoped work into ceremony.

## When to Use
Use when:
- the request is ambiguous, incomplete, contradictory, broad, or multi-path
- codebase reality conflicts with the request
- assumptions would materially change behavior, UX, contracts, data safety, architecture, or operations
- requirements depend on prior work, external evidence, papers, or comparing approaches

Do not use for trivial/scoped changes where the implementation path is obvious and assumptions are low-risk; state assumptions briefly and proceed.

## Scope Triage
Classify before asking questions:
- **Trivial/scoped:** low-risk path is obvious -> state assumptions and proceed.
- **Ambiguous:** assumptions affect important behavior or risk -> ask the smallest targeted question.
- **Multi-path:** viable approaches have meaningful tradeoffs -> offer 2-3 short options, recommend one, ask for alignment.
- **Broad/product/design-heavy:** purpose, success criteria, non-goals, or boundaries are unstable -> align on desired outcome before planning.

Urgency is not permission to guess. If the user says "just do it" or "quick fix", proceed only when assumptions are low-risk; otherwise ask one high-leverage question or state the risky assumption and get alignment.

## Concise Alignment
- Ask the highest-leverage missing question first; follow up only if the answer leaves material ambiguity.
- Prefer one precise question per turn.
- Keep options to 2-3 one-line choices plus a recommendation when useful.
- Avoid long menus, exhaustive tradeoff essays, and speculative directions unless asked.
- When possible, propose a default assumption and quick confirmation.
- If the user chooses quickly from an under-explained list, restate the key consequence before committing to high-impact work.

## Workflow
1. Inspect relevant code and local project instructions first.
2. Restate the task in plain language, separating requested mechanism from underlying goal when they differ.
3. Triage scope and identify missing inputs, unclear constraints, codebase mismatches, contract concerns, evidence gaps, and environment constraints.
4. When evidence gaps materially affect scope, use focused Feynman research before locking assumptions: `session-search`, `alpha-research`, `literature-review`, `source-comparison`, or `deep-research` as appropriate.
5. Ask targeted questions only when assumptions materially affect behavior, architecture, data safety, or user experience.
6. If low-risk assumptions are enough, state them and continue.
7. For multi-path work, present 2-3 concise approaches with the main tradeoff and a recommendation.
8. Produce compact requirements covering current behavior, desired behavior, invariants, non-functional concerns, non-goals, assumptions, risks, and validation implications.

## Output Shape
Use only as much structure as the situation needs:

```md
Understanding: ...
Requirements:
- ...
Non-goals / boundaries:
- ...
Assumptions:
- ...
Risks / unknowns:
- ...
```

If local conventions, generated-artifact flows, or public contracts constrain the work, include them as requirements. If the request conflicts with codebase or local guidance, say so clearly and ask for direction.
