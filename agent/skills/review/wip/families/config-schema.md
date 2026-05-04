# F8 — Config / Schema / Migration Drift

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #unsafe-default

**Pattern:** A new option or altered default changes behavior, but callers, deployment configs, or docs still assume the old baseline.

**Likely consequence:** Production-only regressions, rollout surprises, inconsistent behavior across environments.

**Investigation questions:**
- What happens when the new config is absent?
- Are rollout paths, docs, and existing deploy manifests updated?
- Is the default safe?

**False-positive traps:**
- Feature flags sometimes intentionally default to off or inherit old behavior.

## #unsynced-schema-consumers

**Pattern:** A schema, migration, or serialized representation changes without synchronized updates in validators, readers, writers, or backfill logic.

**Likely consequence:** Data corruption, failed deploys, read/write incompatibility, rollback pain.

**Investigation questions:**
- Which producers and consumers need coordinated updates?
- Is backward compatibility needed during rollout?
- Can old and new formats coexist safely?

**False-positive traps:**
- Single-step incompatible migrations can be valid in locked deployment models; verify rollout assumptions.
