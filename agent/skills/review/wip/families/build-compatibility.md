# F7 — Build / Analysis / Compatibility Drift

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #ci-contract-drift

**Pattern:** Code changes assume a build, packaging, or CI behavior that the surrounding repo configuration does not match.

**Likely consequence:** CI breakage, packaging failure, missing artifacts, environment-specific failures.

**Investigation questions:**
- Were lockfiles, scripts, CI configs, containers, and generated artifacts updated consistently?
- Is the new requirement available in supported environments?

**False-positive traps:**
- Some repos intentionally stage build changes separately; confirm branch conventions before claiming a bug.

## #compat-assumption-drift

**Pattern:** The change relies on a language, API, platform, or environment behavior that may not hold across supported versions.

**Likely consequence:** Works locally but fails in older or alternate supported environments.

**Investigation questions:**
- What versions and platforms are promised?
- Were compatibility tests or guards updated?
- Is there a graceful fallback?

**False-positive traps:**
- If support policy changed explicitly in the same PR, incompatibility may be intentional.
