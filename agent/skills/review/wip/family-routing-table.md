# Family Routing Table

Use this table only for a **challenge pass after an unprimed review**, not as the first lens on the diff.

## Evidence-strength legend

Each family file declares `evidence_strength` in its front matter:
- `empirical` — directly supported by code-review or missed-bug literature
- `benchmark-supported` — strongly motivated by recent LLM/agent review benchmarks
- `practical-heuristic` — engineering synthesis; apply more verifier skepticism

## Rule of thumb
- Pick **2–5 families**.
- Load only those family files; do not read the full set.
- Prefer **specific cues** over generic concern buckets.
- If a family requires repository search or runtime evidence, route it to a scout.
- If no family fits well, use `outside-corpus` instead of forcing a match.

## Index

| Change cue | Family file | Patterns | Notes |
|---|---|---|---|
| Changed conditionals, branching, validation, eligibility logic | [families/semantic-logic.md](families/semantic-logic.md) | `#weakened-guard`, `#invariant-violation` | Strong medium-reviewer family |
| API return shape, nullability, defaults, parameter meaning changed | [families/contract-drift.md](families/contract-drift.md) | `#return-shape-drift`, `#parameter-semantics-drift` | Usually cross-file; use impact scout |
| Refactor, rename, helper move, partial adoption, duplicate paths | [families/incomplete-propagation.md](families/incomplete-propagation.md) | `#sibling-path-stale`, `#partial-rebinding` | Search for unchanged siblings / callers |
| New throws, retries, timeout handling, early returns, cleanup movement | [families/error-path.md](families/error-path.md) | `#unhandled-failure`, `#cleanup-skipped` | Often needs semantic scout |
| Resource ownership, caching, init/teardown, lifecycle hooks | [families/state-lifecycle.md](families/state-lifecycle.md) | `#ownership-mismatch`, `#lifecycle-order-drift` | Runtime-sensitive; do not overclaim |
| Non-trivial behavior change with weak or missing tests / test plan | [families/test-gap.md](families/test-gap.md) | `#behavior-without-test`, `#shallow-test-plan` | Strong medium-reviewer family |
| Dependency, CI, script, build flag, version, platform support changes | [families/build-compatibility.md](families/build-compatibility.md) | `#ci-contract-drift`, `#compat-assumption-drift` | Check local config before keeping finding |
| Feature flags, env vars, schema, migrations, validator changes | [families/config-schema.md](families/config-schema.md) | `#unsafe-default`, `#unsynced-schema-consumers` | Heuristic family; route to scout |
| Auth, policy, validation, secrets, boundary exposure | [families/security-boundary.md](families/security-boundary.md) | `#validation-bypass`, `#privilege-broadened` | Narrow claims only |
| Async fan-out, shared mutable state, retries, timers, ordering | [families/concurrency.md](families/concurrency.md) | `#unsynchronized-shared-state`, `#ordering-assumption-drift` | Runtime-sensitive; scout or verifier caution |
| Duplicated logic, architecture bypass, docs/examples drift | [families/design-docs.md](families/design-docs.md) | `#tangled-implementation`, `#docs-drift` | Suppress taste-only style feedback |
| Tangled PR, giant prompt, noisy generic checks, weak context | [families/review-process.md](families/review-process.md) | `#tangled-pr`, `#prompt-overload` | Useful for reviewer/system-designer meta feedback |

## Reference syntax

When a triage or scout names a pattern, use the form `families/<file>.md#<anchor>` so the reference resolves directly to the entry. Example: `families/security-boundary.md#privilege-broadened`. Use `outside-corpus` when no family fits.

## Escalation defaults

### Safe medium-reviewer defaults
- semantic-logic
- test-gap
- security-boundary
- design-docs
- review-process

### Usually scout-first families
- contract-drift
- incomplete-propagation
- error-path
- state-lifecycle
- build-compatibility
- config-schema
- concurrency
