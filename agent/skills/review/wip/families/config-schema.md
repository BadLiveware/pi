---
family: config-schema
fid: F8
scope: cross-file → repo
evidence_strength: practical-heuristic
default_stages: specialist-scout
---

# F8 — Config / Schema / Migration Drift

Config, schema, migrations, and consumers diverge. Heuristic family; route to a scout.

Change cues: feature flags, env vars, schema/migration files, validator edits, serialization or parsing code.

## #unsafe-default
Configuration added or changed without safe default semantics.

- **Pattern:** A new option or altered default changes behavior, but callers, deployment configs, or docs still assume the old baseline.
- **Signals:** New flag; default value change; environment-variable rename; fallback logic removed.
- **Scope:** cross-file → repo.
- **Likely consequence:** Production-only regressions, rollout surprises, inconsistent behavior across environments.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - What happens when the new config is absent?
  - Are rollout paths, docs, and existing deploy manifests updated?
  - Is the default safe?
- **False-positive traps:**
  - Feature flags sometimes intentionally default to off or inherit old behavior.

## #unsynced-schema-consumers
Schema or migration change without consumer synchronization.

- **Pattern:** A schema, migration, or serialized representation changes without synchronized updates in validators, readers, writers, or backfill logic.
- **Signals:** Migration files changed; renamed fields; validator edits without consumer edits; serialization or parsing logic touched in only one layer.
- **Scope:** cross-file → repo.
- **Likely consequence:** Data corruption, failed deploys, read/write incompatibility, rollback pain.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Which producers and consumers need coordinated updates?
  - Is backward compatibility needed during rollout?
  - Can old and new formats coexist safely?
- **False-positive traps:**
  - Single-step incompatible migrations can be valid in locked deployment models; verify rollout assumptions.
