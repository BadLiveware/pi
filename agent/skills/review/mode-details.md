# Code Review Mode Details

Load this file when `SKILL.md` selects `standard`, `full`, or `audit`, or when a `light` review discovers concrete high-risk concerns.

## Shared Review Stages for Standard and Full
Use these stages proportionally; do not turn them into audit paperwork for small changes.

1. **Change-family tagging**: API/contract, control-flow/state-machine, persistence/schema/migration, config/protocol/flag, auth/security boundary, performance/resource lifecycle, UI-only, docs-only, or test-only.
2. **Impact map**: capture changed symbols, impacted callers/callees, relevant tests, config/schema/docs, public contract risks, and unchanged consumers worth inspecting.
3. **Context packet**: summarize intent, change families, impact map, relevant project guidance, prior validation, and deterministic evidence already known. Keep snippets anchored and compact.
4. **Artifact routing**: when delegating, prefer `output: false` unless saved artifacts are useful. If artifacts are needed, route them under `.pi/review/<review-name>/` in the reviewed repo with specific filenames; use `{chain_dir}` or another temp/dedicated artifact directory only when repo-local `.pi/review/` artifacts are not desired. Never write review artifacts to the reviewed repo root.
5. **Deterministic evidence lane**: prefer project-native commands and existing configs. Record what was run, what failed/passed, and what was skipped because missing, expensive, risky, or noisy.
6. **Candidate generation**: medium triage and scouts produce candidate issues only. They do not write final comments.
7. **Clustering/dedupe**: merge duplicates by root cause, collapse symptoms into the underlying issue, and remove candidates already explained by stronger evidence.
8. **Verification**: classify retained candidates as `supported-deterministic`, `supported-trace`, `plausible-but-unverified`, or `rejected`.
9. **Coverage-gap check**: when coverage looks weak or risk is high, ask what high-risk change family or changed contract was not inspected. Add at most 2 new candidates, then verify them.
10. **Final ranking/reporting**: rank by severity, confidence, novelty, actionability, and duplicate/suppression concerns.

## Evidence Labels
- `supported-deterministic`: compiler, analyzer, linter, test, build, or reproducible script evidence directly supports the finding.
- `supported-trace`: anchored code/config/schema/caller trace supports the finding, but no runtime/tool failure was produced.
- `plausible-but-unverified`: semantic concern only; useful uncertainty may be reported separately, but not as a proven finding.
- `rejected`: verifier could not support the anchor, causal path, consequence, or current-tree relevance.

## Risk-specific Review Lenses
Apply selectively when the diff matches the trigger; do not run all lenses on every change.

### Performance cost shape
For performance-sensitive changes, review the cost shape: scaling variables, nested loops, repeated scans/parses/shell-outs/queries, caps that only trim output, synchronous interactive work, cache growth, cancellation, and timeouts. When logs/tests do not expose the boundary and the risk justifies privileged tracing, a scoped `bpftrace` probe can provide runtime evidence for syscalls, files, sockets, subprocesses, or resource growth.

### Lifecycle ownership
When a diff adds goroutines, tickers, watchers, informers, reload loops, background workers, or process-global caches, review lifecycle ownership: what starts it, what stops it, which owner/context/Close path controls it, whether tests or recreated handlers can leak it, and whether request-driven or lazy work would be simpler.

### Guards that collapse state
For guards based on booleans, counts, nil checks, or cached summaries, ask whether they collapse distinct meaningful states. If skipped states can still affect behavior, prefer a named domain predicate over incidental checks like `Len()` and expect tests for the edge states.

### Formal or executable models
For complex state machines, concurrency, retries, queues, locks, lifecycle transitions, idempotency, or safety/liveness-sensitive algorithms, consider whether a small formal or executable model (TLA+, PlusCal, Alloy, or a property-test model) would expose missing invariants before signoff. Use selectively; do not make formal modeling a blanket requirement for ordinary code.

### Correctness-critical paths
For correctness-critical paths (state machines, financial/safety calculations, data integrity constraints, authz logic), escalate depth by one tier unless deterministic test coverage proves the relevant edge states and failure modes. Tests written by the same author as the code have a blind spot: they prove the code does what was thought about, not what was missed. When such paths can't be tested deterministically (timing-dependent, complex integration setup, probabilistic), escalate regardless of partial coverage — the review is the last line of defense.

## Light
Use for small localized changes, docs/tests-only changes, mechanical refactors, quick self-review, or user requests that imply a quick check.

- Parent does the review locally.
- No subagents by default.
- Inspect the diff, changed tests, and obvious callers/config only.
- Make a small impact sketch; do not create a formal context packet unless a concrete risk appears.
- Run deterministic commands only when they are obvious, cheap, and project-native.
- Escalate to `standard` only when a concrete high-risk trigger appears.

## Standard Hybrid
Use for ordinary non-trivial feature/fix changes.

Flow:
1. Tag change families and build a compact impact map.
2. Build compact context packet from the impact map.
3. Run cheap project-native evidence: usually Lane A when configured, Lane C/D when triggered by contract or test-impact risk, and Lane B/E only with existing rules or a narrow risk-specific query.
4. Run 1 medium triage reviewer, or do triage locally if parent has enough context.
5. Run at most 2 targeted cheap scouts for high-priority escalation requests.
6. Parent clusters/dedupes candidates by root cause.
7. Verifier checks only retained candidates and assigns evidence labels.
8. Run a bounded coverage-gap check only if the impact map shows a high-risk family with weak inspection.
9. Final report or fix path follows `workflows.md`.

Medium triage caps control routing and noise, not confirmed-bug handling:
- max 5 direct candidates
- max 3 escalation requests
- avoid style nits and generic advice
- stop once scout target is clear

Scout caps control hypothesis generation, not final bug visibility:
- one narrow question per scout
- max 3 candidates unless explicitly asked for exhaustive review
- omit candidates with no concrete path, file anchor, or consequence

## Full Hybrid
Use for high-risk review.

Flow is standard hybrid, with these expanded expectations:
- a stronger impact map including unchanged consumers and config/schema/protocol paths
- Lane A/C/D evidence expected where practical; explain skipped lanes
- Lane B/E used when the change family matches and existing/narrow checks are available
- Lane F only for high-risk unclear issues where the extra cost is justified or explicitly requested; for complex state machines/concurrency, this may include a small TLA+/PlusCal or property-test model of the critical invariant
- up to 2 medium triage reviewers
- at most 3 targeted cheap scouts
- a bounded coverage-gap check before final ranking
- strong verifier recommended for retained candidates

Run full when change touches auth/security, data loss, migrations/schema/config, concurrency/resource lifecycles, public APIs/contracts, performance-sensitive paths, broad cross-file changes, artifact/protocol contracts, or unclear intent.

## Audit
Use only when explicitly requested.

- Many-agent or exhaustive review is allowed.
- Broader deterministic tool lanes and generated verification scripts are allowed when safe.
- Corpus prompt pack may be used more fully, but still after an unprimed pass.
- Report cost/latency expectation if it is likely to be material.
- Separate supported findings, plausible/unverified risks, rejected noise, not-checked evidence, and tool/lane gaps.

## Deterministic Tool Lane Policy
Read `tool-lanes.md` when selecting concrete tools. Core policy:

- Prefer repo-sanctioned commands from README, CI, package scripts, Makefile, justfile, taskfile, tox/nox, cargo aliases, or solution files.
- Use language/tool examples only when no better project command exists.
- Do not install or add analyzers without permission.
- Avoid broad generic scans unless the repo already configures them or the review is `audit`.
- Keep only findings connected to the diff and supported by a credible consequence.
- Record skipped lanes when they would matter but were unavailable, too slow, unsafe, or likely noisy.

## Optional Failure-mode Corpus Challenge
Use `wip/family-routing-table.md` only after unprimed triage and only when coverage looks weak or risk is high.

Rules:
- shortlist 2-5 families and load only the matching `wip/families/<family>.md` files
- reference patterns as `families/<file>.md#<anchor>`
- use patterns as hypothesis generators, not verdicts
- keep `outside-corpus` for concerns that do not fit
- treat `corpus-suggested` candidates more skeptically than unprompted candidates, and apply extra skepticism to families marked `evidence_strength: practical-heuristic` in `wip/family-routing-table.md`
- reject forced fits
- do not load the full set of family files unless doing audit or prompt-development work

## Coverage-gap Pass
Use after candidate verification, before final ranking, when standard/full review may have missed a high-risk area.

Prompt focus:
- Which high-risk change family lacks inspection?
- Which changed contract lacks caller/unchanged-consumer review?
- Which backend/config/schema/test-impact path was only diff-read?

Constraints:
- max 2 new candidates
- each must name the missing coverage path
- no random new issue hunting
- new candidates must still pass normal verification

## Escalation Hints
Common targeted scouts:
- `impact/caller`: changed contracts, artifacts, config, migrations, unchanged consumers
- `correctness-path`: changed control/data paths, state transitions, error handling; challenge guards that collapse richer state into one boolean/count/nil check
- `test-gap`: behavior changed but tests/fixtures/assertions do not prove it; for registries, queues, caches, indexes, and stateful helpers, check no-entry, valid-entry, error/conflict/pending-only, and mixed-state cases when those states affect behavior
- `config/protocol`: feature flags, compatibility modes, test-stack defaults, build/runtime contracts
- `security-boundary`: trust boundaries, authz/authn, injection, secrets
- `performance/resource`: concurrency, cleanup, lifecycle, memory bounds, hot paths; challenge every new goroutine/ticker/watcher/reload loop for owner cancellation and test/handler recreation leaks
