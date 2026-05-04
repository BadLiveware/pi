---
family: incomplete-propagation
fid: F3
scope: cross-file → repo
evidence_strength: benchmark-supported
default_stages: specialist-scout
---

# F3 — Incomplete Propagation / Partial Refactor

Change applied in some but not all required places. Search for unchanged siblings and callers.

Change cues: refactor, rename, helper move, partial adoption, duplicate paths, registration tables.

## #sibling-path-stale
One path updated, sibling path left behind.

- **Pattern:** A change fixes or refactors one code path but leaves parallel or duplicated paths inconsistent.
- **Signals:** Similar functions or classes nearby; duplicated branches; only some call sites changed; one implementation migrated while another remains old.
- **Scope:** cross-file → repo.
- **Likely consequence:** Inconsistent behavior depending on entry point or deployment path.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Are there siblings, overloads, adapters, or duplicate implementations that should change too?
  - Is search-based impact analysis clean?
- **False-positive traps:**
  - Not every textual similarity implies required co-change.
  - Variants may intentionally differ.

## #partial-rebinding
Refactor changed abstraction but not all bindings.

- **Pattern:** A refactor updates a type, abstraction, helper, or interface in one layer but leaves wiring, registration, or callers partially old.
- **Signals:** Renamed symbols; moved helpers; constructor signature changes; dependency-injection registration unchanged; factory map or router table untouched.
- **Scope:** cross-file → repo.
- **Likely consequence:** Build failure, dead path, stale dependency, or wrong implementation selection.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Were all registrations, factories, imports, and adapters updated?
  - Does repository search show old symbol usage in live paths?
- **False-positive traps:**
  - Temporary compatibility shims can make mixed usage valid.
