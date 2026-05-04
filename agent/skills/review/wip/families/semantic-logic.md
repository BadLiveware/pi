# F1 — Semantic / Logic Mismatch

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #weakened-guard

**Pattern:** A condition, guard, or precondition changed in a way that reverses or weakens intended behavior.

**Likely consequence:** Wrong behavior on valid or invalid inputs; silent correctness regression.

**Investigation questions:**
- Which input classes now flow through each branch?
- Was the old guard intentionally restrictive?
- Are tests covering both sides of the changed condition?

**False-positive traps:**
- Intentional product-policy changes can look like regressions.
- Renamed helper functions may obscure unchanged semantics.

## #invariant-violation

**Pattern:** A change updates a step in a workflow without preserving an expected invariant or valid state transition.

**Likely consequence:** Subtle correctness failures that appear only after multi-step interaction.

**Investigation questions:**
- What invariant should hold before and after this change?
- Are all valid transitions still represented?
- Does any new path skip an old state update?

**False-positive traps:**
- Some apparent invariants are only conventions, not hard requirements.
- Avoid asserting a bug without identifying the expected state model.
