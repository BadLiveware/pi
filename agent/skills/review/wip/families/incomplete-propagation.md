# F3 — Incomplete Propagation / Partial Refactor

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #sibling-path-stale

**Pattern:** A change fixes or refactors one code path but leaves parallel or duplicated paths inconsistent.

**Likely consequence:** Inconsistent behavior depending on entry point or deployment path.

**Investigation questions:**
- Are there siblings, overloads, adapters, or duplicate implementations that should change too?
- Is search-based impact analysis clean?

**False-positive traps:**
- Not every textual similarity implies required co-change.
- Variants may intentionally differ.

## #partial-rebinding

**Pattern:** A refactor updates a type, abstraction, helper, or interface in one layer but leaves wiring, registration, or callers partially old.

**Likely consequence:** Build failure, dead path, stale dependency, or wrong implementation selection.

**Investigation questions:**
- Were all registrations, factories, imports, and adapters updated?
- Does repository search show old symbol usage in live paths?

**False-positive traps:**
- Temporary compatibility shims can make mixed usage valid.
