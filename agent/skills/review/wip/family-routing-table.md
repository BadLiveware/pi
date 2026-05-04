# Family Routing Table

All routing inputs for the failure-mode corpus live in this file: change cues, signals, scope, recommended stage, evidence strength. Family files at `families/<family>.md` hold only operational content (pattern description, consequence, investigation questions, false-positive traps) for the dispatched scout or verifier — they do not duplicate routing data.

Use this table only for a **challenge pass after an unprimed review**, not as the first lens on the diff.

## Evidence-strength legend
- `empirical` — directly supported by code-review or missed-bug literature
- `benchmark-supported` — strongly motivated by recent LLM/agent review benchmarks
- `practical-heuristic` — engineering synthesis; apply more verifier skepticism

## Rule of thumb
- Pick **2–5 families** for the challenge pass.
- Load only the corresponding family files; do not read the full set.
- Prefer **specific cues** over generic concern buckets.
- If a pattern requires repository search or runtime evidence, route it to a scout.
- If no pattern fits well, use `outside-corpus` instead of forcing a match.

## Reference syntax
Patterns are addressed as `families/<file>.md#<anchor>`, e.g. `families/security-boundary.md#privilege-broadened`. Use this form in scout assignments and verifier output.

---

## semantic-logic — F1 — Semantic / Logic Mismatch
- **file:** [families/semantic-logic.md](families/semantic-logic.md)
- **evidence_strength:** empirical
- **change cues:** changed conditionals, branching, validation, eligibility logic, state transitions

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#weakened-guard](families/semantic-logic.md#weakened-guard) | changed boolean expr; removed branch; broadened match; `\|\|` vs `&&`; negation added/removed | local | medium-reviewer → verifier |
| [#invariant-violation](families/semantic-logic.md#invariant-violation) | assignment-order changes; new early return; removed validation; state-enum edits; new mutation in existing path | local → runtime | specialist-scout |

## contract-drift — F2 — Contract Drift
- **file:** [families/contract-drift.md](families/contract-drift.md)
- **evidence_strength:** benchmark-supported
- **change cues:** API return shape, nullability, defaults, parameter meaning, units, enum values

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#return-shape-drift](families/contract-drift.md#return-shape-drift) | return-type edits; sentinel/exception conversion; optional field introduced; changed success/error object shape | cross-file | specialist-scout |
| [#parameter-semantics-drift](families/contract-drift.md#parameter-semantics-drift) | renamed parameter; default value change; enum meaning change; unit-conversion edits; changed interpretation in docs | cross-file | specialist-scout |

## incomplete-propagation — F3 — Incomplete Propagation / Partial Refactor
- **file:** [families/incomplete-propagation.md](families/incomplete-propagation.md)
- **evidence_strength:** benchmark-supported
- **change cues:** refactor, rename, helper move, partial adoption, duplicate paths, registration tables

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#sibling-path-stale](families/incomplete-propagation.md#sibling-path-stale) | similar functions/classes nearby; duplicated branches; only some call sites changed | cross-file → repo | specialist-scout |
| [#partial-rebinding](families/incomplete-propagation.md#partial-rebinding) | renamed symbols; moved helpers; constructor signature changes; DI registration unchanged; factory map untouched | cross-file → repo | specialist-scout |

## error-path — F4 — Error-path / Recovery-path Mismatch
- **file:** [families/error-path.md](families/error-path.md)
- **evidence_strength:** benchmark-supported
- **change cues:** new throws, retries, timeout handling, early returns, cleanup movement, lock or transaction scope edits

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#unhandled-failure](families/error-path.md#unhandled-failure) | new `throw`; new fallible I/O; timeout/retry addition; optional return; removed catch | local → cross-file | medium-reviewer → specialist-scout |
| [#cleanup-skipped](families/error-path.md#cleanup-skipped) | added early `return`; reordered cleanup; resource acquisition moved upward; lock/transaction opened before new branch | local → runtime | specialist-scout |

## state-lifecycle — F5 — State / Lifecycle / Resource Handling
- **file:** [families/state-lifecycle.md](families/state-lifecycle.md)
- **evidence_strength:** empirical
- **change cues:** caching, pooling, init/teardown, lifecycle hooks, callback registration, handle storage in broader scope

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#ownership-mismatch](families/state-lifecycle.md#ownership-mismatch) | caching added; object retained across requests; pool usage changed; reference stored in broader scope | runtime | specialist-scout |
| [#lifecycle-order-drift](families/state-lifecycle.md#lifecycle-order-drift) | moved setup code; constructor changes; hooks added or reordered; listener registration altered | local → runtime | specialist-scout |

## test-gap — F6 — Test / Behavioral Evidence Gap
- **file:** [families/test-gap.md](families/test-gap.md)
- **evidence_strength:** empirical
- **change cues:** non-trivial behavior change with no test diff; only snapshot churn; vague or happy-path-only test plan

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#behavior-without-test](families/test-gap.md#behavior-without-test) | non-trivial code-path edits; no test diff; only snapshot churn; assertions broad or indirect | repo | medium-reviewer |
| [#shallow-test-plan](families/test-gap.md#shallow-test-plan) | happy-path-only test plan; vague "tested locally"; no compatibility/rollback story; no mention of integrations | repo / process | medium-reviewer |

## build-compatibility — F7 — Build / Analysis / Compatibility Drift
- **file:** [families/build-compatibility.md](families/build-compatibility.md)
- **evidence_strength:** empirical
- **change cues:** dependency, CI, script, build flag, version, platform-support, generated-file changes

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#ci-contract-drift](families/build-compatibility.md#ci-contract-drift) | new dependency; generated-file expectation; changed build flags; version bump without CI/script updates | repo | specialist-scout |
| [#compat-assumption-drift](families/build-compatibility.md#compat-assumption-drift) | new API usage; removed fallback; dependency major-version change; environment-specific path handling | repo / runtime | specialist-scout |

## config-schema — F8 — Config / Schema / Migration Drift
- **file:** [families/config-schema.md](families/config-schema.md)
- **evidence_strength:** practical-heuristic
- **change cues:** feature flags, env vars, schema/migration files, validator edits, serialization or parsing code

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#unsafe-default](families/config-schema.md#unsafe-default) | new flag; default value change; env-var rename; fallback logic removed | cross-file → repo | specialist-scout |
| [#unsynced-schema-consumers](families/config-schema.md#unsynced-schema-consumers) | migration files changed; renamed fields; validator edits without consumer edits; serialization touched in only one layer | cross-file → repo | specialist-scout |

## security-boundary — F9 — Security-boundary Regression
- **file:** [families/security-boundary.md](families/security-boundary.md)
- **evidence_strength:** empirical
- **change cues:** auth, policy, input validation, secret handling, exposure widening, default mode loosening

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#validation-bypass](families/security-boundary.md#validation-bypass) | new route or handler; moved auth logic; input path bypassing validation helper; direct sink access added | local → cross-file | specialist-scout |
| [#privilege-broadened](families/security-boundary.md#privilege-broadened) | more permissive policy; secret-handling change; wider wildcard; debug feature exposed; default security mode loosened | local → repo | medium-reviewer → specialist-scout |

## concurrency — F10 — Concurrency / Timing / Ordering Hazard
- **file:** [families/concurrency.md](families/concurrency.md)
- **evidence_strength:** empirical
- **change cues:** async fan-out, shared mutable state, retries, timers, callbacks, queue semantics, lock-scope edits

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#unsynchronized-shared-state](families/concurrency.md#unsynchronized-shared-state) | shared cache/map edits; async parallelism added; background worker introduced; lock scope changed | runtime | specialist-scout |
| [#ordering-assumption-drift](families/concurrency.md#ordering-assumption-drift) | retry logic added; callbacks reordered; timers changed; async fan-out introduced; queue semantics altered | runtime | specialist-scout |

## design-docs — F11 — Design / Docs / Maintainability Mismatch
- **file:** [families/design-docs.md](families/design-docs.md)
- **evidence_strength:** benchmark-supported
- **change cues:** duplicated logic, architecture bypass, scattered special cases, public-API behavior change, stale comments or examples

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#tangled-implementation](families/design-docs.md#tangled-implementation) | copy-pasted branches; feature logic embedded in unrelated layers; special cases scattered; new abstraction only partially adopted | local → repo | medium-reviewer |
| [#docs-drift](families/design-docs.md#docs-drift) | public API changes; CLI behavior changes; example outputs stale; comment contradicts code | local → repo | medium-reviewer |

## review-process — F12 — Review-process / Context Failure
- **file:** [families/review-process.md](families/review-process.md)
- **evidence_strength:** practical-heuristic
- **change cues:** tangled PR, giant prompt, all heuristics injected at once, missing reduction stage, repeated style nits

| Pattern | Signals | Scope | Stage |
|---|---|---|---|
| [#tangled-pr](families/review-process.md#tangled-pr) | refactor + feature + rename + dependency bump in one PR; many files with unrelated motives; hard-to-explain narrative | process / repo | medium-reviewer |
| [#prompt-overload](families/review-process.md#prompt-overload) | giant prompt; all heuristics injected at once; repeated stylistic comments; missing reduction stage | process | verifier / system-designer |

---

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
