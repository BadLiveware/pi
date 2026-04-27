# Code Review Mode Details

Load this file when `SKILL.md` selects `standard`, `full`, or `audit`, or when a `light` review discovers concrete high-risk concerns.

## Light
Use for small localized changes, docs/tests-only changes, mechanical refactors, quick self-review, or user requests that imply a quick check.

- Parent does the review locally.
- No subagents by default.
- Inspect the diff, changed tests, and obvious callers only.
- Escalate to `standard` only when a concrete high-risk trigger appears.

## Standard Hybrid
Use for ordinary non-trivial feature/fix changes.

Flow:
1. Build compact context packet.
2. Run 1 medium triage reviewer, or do triage locally if parent has enough context.
3. Run at most 2 targeted cheap scouts for high-priority escalation requests.
4. Parent condenses candidates.
5. Verifier checks only retained candidates.
6. Final report or fix path follows `workflows.md`.

Medium triage caps control routing and noise, not confirmed-bug handling:
- max 5 direct findings
- max 3 escalation requests
- avoid style nits and generic advice
- stop once scout target is clear

Scout caps control hypothesis generation, not final bug visibility:
- one narrow question per scout
- max 3 candidates unless explicitly asked for exhaustive review
- omit candidates with no concrete path, file anchor, or consequence

## Full Hybrid
Use for high-risk review.

Flow is standard hybrid, with these expanded limits:
- up to 2 medium triage reviewers
- at most 3 targeted cheap scouts
- deterministic evidence required where available
- stronger verifier recommended

Run full when change touches auth/security, data loss, migrations/schema/config, concurrency/resource lifecycles, public APIs/contracts, performance-sensitive paths, broad cross-file changes, artifact/protocol contracts, or unclear intent.

## Audit
Use only when explicitly requested.

- Many-agent or exhaustive review is allowed.
- Corpus prompt pack may be used more fully, but still after an unprimed pass.
- Report cost/latency expectation if it is likely to be material.
- Separate supported findings, plausible/unverified risks, rejected noise, and not-checked evidence.

## Optional Failure-mode Corpus Challenge
Use `wip/family-routing-table.md` only after unprimed triage and only when coverage looks weak or risk is high.

Rules:
- shortlist 2-5 families
- use entries as hypothesis generators, not verdicts
- keep `outside-corpus` for concerns that do not fit
- treat `corpus-suggested` candidates more skeptically than unprompted candidates
- reject forced fits
- do not inject the full corpus unless doing audit or prompt-development work

## Escalation Hints
Common targeted scouts:
- `impact/caller`: changed contracts, artifacts, config, migrations, unchanged consumers
- `correctness-path`: changed control/data paths, state transitions, error handling
- `test-gap`: behavior changed but tests/fixtures/assertions do not prove it
- `config/protocol`: feature flags, compatibility modes, test-stack defaults, build/runtime contracts
- `security-boundary`: trust boundaries, authz/authn, injection, secrets
- `performance/resource`: concurrency, cleanup, lifecycle, memory bounds, hot paths
