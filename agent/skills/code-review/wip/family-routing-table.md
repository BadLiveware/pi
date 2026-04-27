# Family Routing Table

Use this table only for a **challenge pass after an unprimed review**, not as the first lens on the diff.

## Rule of thumb
- Pick **2–5 families**.
- Prefer **specific cues** over generic concern buckets.
- If a family requires repository search or runtime evidence, route it to a scout.
- If no family fits well, use `outside-corpus` instead of forcing a match.

| Change cue | Likely families | Entry IDs to consider first | Notes |
|---|---|---|---|
| Changed conditionals, branching, validation, eligibility logic | F1 Semantic / logic mismatch | `FM-SEM-001`, `FM-SEM-002` | Strong medium-reviewer family |
| API return shape, nullability, defaults, param meaning changed | F2 Contract drift | `FM-CON-001`, `FM-CON-002` | Usually cross-file; use impact scout |
| Refactor, rename, helper move, partial adoption, duplicate paths | F3 Incomplete propagation | `FM-REF-001`, `FM-REF-002` | Search for unchanged siblings / callers |
| New throws, retries, timeout handling, early returns, cleanup movement | F4 Error-path mismatch | `FM-ERR-001`, `FM-ERR-002` | Often needs semantic scout |
| Resource ownership, caching, init/teardown, lifecycle hooks | F5 State / lifecycle / resource | `FM-RES-001`, `FM-RES-002` | Runtime-sensitive; do not overclaim |
| Non-trivial behavior change with weak or missing tests / test plan | F6 Test / behavioral evidence gap | `FM-TST-001`, `FM-TST-002` | Strong medium-reviewer family |
| Dependency, CI, script, build flag, version, platform support changes | F7 Build / compatibility drift | `FM-BLD-001`, `FM-BLD-002` | Check local config before keeping finding |
| Feature flags, env vars, schema, migrations, validator changes | F8 Config / schema / migration drift | `FM-CFG-001`, `FM-CFG-002` | Heuristic family; route to scout |
| Auth, policy, validation, secrets, boundary exposure | F9 Security-boundary regression | `FM-SEC-001`, `FM-SEC-002` | Narrow claims only |
| Async fan-out, shared mutable state, retries, timers, ordering | F10 Concurrency / timing hazard | `FM-CONC-001`, `FM-CONC-002` | Runtime-sensitive; scout or verifier caution |
| Duplicated logic, architecture bypass, docs/examples drift | F11 Design / docs / maintainability | `FM-DES-001`, `FM-DES-002` | Suppress taste-only style feedback |
| Tangled PR, giant prompt, noisy generic checks, weak context | F12 Review-process / context failure | `FM-REV-001`, `FM-REV-002` | Useful for reviewer/system-designer meta feedback |

## Escalation defaults

### Safe medium-reviewer defaults
- F1 Semantic / logic mismatch
- F6 Test / behavioral evidence gap
- F9 Security-boundary regression
- F11 Design / docs / maintainability mismatch
- F12 Review-process / context failure

### Usually scout-first families
- F2 Contract drift
- F3 Incomplete propagation
- F4 Error-path mismatch
- F5 State / lifecycle / resource handling
- F7 Build / compatibility drift
- F8 Config / schema / migration drift
- F10 Concurrency / timing hazard
