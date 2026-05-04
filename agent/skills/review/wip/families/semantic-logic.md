---
family: semantic-logic
fid: F1
scope: local → runtime
evidence_strength: empirical
default_stages: medium-reviewer, verifier
---

# F1 — Semantic / Logic Mismatch

Wrong behavior despite plausible local code edits. Strong medium-reviewer family.

Change cues: changed conditionals, branching, validation, eligibility logic, state transitions.

## #weakened-guard
Conditional inversion or weakened guard.

- **Pattern:** A condition, guard, or precondition changed in a way that reverses or weakens intended behavior.
- **Signals:** Changed boolean expression; removed branch; broadened match; `||` vs `&&`; negation added or removed.
- **Scope:** local.
- **Likely consequence:** Wrong behavior on valid or invalid inputs; silent correctness regression.
- **Recommended stage:** medium-reviewer → verifier.
- **Investigation questions:**
  - Which input classes now flow through each branch?
  - Was the old guard intentionally restrictive?
  - Are tests covering both sides of the changed condition?
- **False-positive traps:**
  - Intentional product-policy changes can look like regressions.
  - Renamed helper functions may obscure unchanged semantics.

## #invariant-violation
Invariant or state-transition violation.

- **Pattern:** A change updates a step in a workflow without preserving an expected invariant or valid state transition.
- **Signals:** Assignment-order changes; new early return; removed validation; state-enum edits; additional mutation in an existing path.
- **Scope:** local → runtime.
- **Likely consequence:** Subtle correctness failures that appear only after multi-step interaction.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - What invariant should hold before and after this change?
  - Are all valid transitions still represented?
  - Does any new path skip an old state update?
- **False-positive traps:**
  - Some apparent invariants are only conventions, not hard requirements.
  - Avoid asserting a bug without identifying the expected state model.
