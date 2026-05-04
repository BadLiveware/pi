---
family: build-compatibility
fid: F7
scope: repo → runtime
evidence_strength: empirical
default_stages: specialist-scout
---

# F7 — Build / Analysis / Compatibility Drift

CI, tooling, environment, or compatibility breaks. Check local config before keeping a finding.

Change cues: dependency, CI, script, build flag, version, platform-support, generated-file changes.

## #ci-contract-drift
Build or CI contract drift.

- **Pattern:** Code changes assume a build, packaging, or CI behavior that the surrounding repo configuration does not match.
- **Signals:** New dependency; generated-file expectation; changed build flags; version bump without CI or script updates.
- **Scope:** repo.
- **Likely consequence:** CI breakage, packaging failure, missing artifacts, environment-specific failures.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Were lockfiles, scripts, CI configs, containers, and generated artifacts updated consistently?
  - Is the new requirement available in supported environments?
- **False-positive traps:**
  - Some repos intentionally stage build changes separately; confirm branch conventions before claiming a bug.

## #compat-assumption-drift
Compatibility assumption drift.

- **Pattern:** The change relies on a language, API, platform, or environment behavior that may not hold across supported versions.
- **Signals:** New API usage; removed fallback; dependency major-version change; environment-specific path handling.
- **Scope:** repo / runtime.
- **Likely consequence:** Works locally but fails in older or alternate supported environments.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - What versions and platforms are promised?
  - Were compatibility tests or guards updated?
  - Is there a graceful fallback?
- **False-positive traps:**
  - If support policy changed explicitly in the same PR, incompatibility may be intentional.
