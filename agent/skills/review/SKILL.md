---
name: review
description: Use when reviewing changed code, pull request diffs, or implementation work for defects, risk, tests, maintainability, security, performance, or repository impact.
---

# Code Review

Review code as a high-signal risk assessment: scale effort to risk, retrieve the right unchanged context, verify likely real issues, explain consequence, and suppress speculative noise.

## Core Rules
- Pick the cheapest review depth that can catch the likely risk; a 5-minute code change should not trigger a 10-minute review cycle.
- Tag change families early: API/contract, control-flow/state-machine, persistence/schema/migration, config/protocol/flag, auth/security boundary, performance/resource lifecycle, UI-only, docs-only, or test-only.
- Prefer impact mapping and deterministic evidence before adding reviewers. More agents do not compensate for missing callers, configs, tests, or contract context.
- For `standard` and `full`, build a compact impact map before delegation or final ranking: changed symbols, impacted callers/callees, relevant tests, config/schema/docs, public contract risks, and unchanged consumers worth inspecting.
- Use deterministic tool lanes as a menu, not a checklist. Prefer project-native commands and existing configs; do not install tools, run broad noisy scans, or surface unrelated analyzer output unless the user asked for that scope.
- For performance-sensitive changes, review the cost shape: scaling variables, nested loops, repeated scans/parses/shell-outs/queries, caps that only trim output, synchronous interactive work, cache growth, cancellation, and timeouts.
- When a diff adds goroutines, tickers, watchers, informers, reload loops, background workers, or process-global caches, review lifecycle ownership: what starts it, what stops it, which owner/context/Close path controls it, whether tests or recreated handlers can leak it, and whether request-driven or lazy work would be simpler.
- For guards based on booleans, counts, nil checks, or cached summaries, ask whether they collapse distinct meaningful states. If skipped states can still affect behavior, prefer a named domain predicate over incidental checks like `Len()` and expect tests for the edge states.
- For complex state machines, concurrency, retries, queues, locks, lifecycle transitions, idempotency, or safety/liveness-sensitive algorithms, consider whether a small formal or executable model (for example TLA+, PlusCal, Alloy, or a property-test model) would expose missing invariants before implementation or review signoff. Use this selectively; do not make formal modeling a blanket requirement for ordinary code.
- Keep candidate generation, clustering/dedupe, verification, and final comments separate. Triage and scouts produce candidates, not user-facing comments.
- Label every retained candidate as `supported-deterministic`, `supported-trace`, `plausible-but-unverified`, or `rejected`. Final findings should normally be `supported-deterministic` or `supported-trace`.
- Require evidence for each finding. If a claim depends on unavailable runtime evidence, mark it uncertain, put it in a separate risk/gap section, or omit it.
- Deduplicate and rank findings by root cause before presenting them. Fewer strong findings beat many weak comments.
- Use caps to control hypothesis generation, fanout, and report readability; never silently drop verified supported issues.
- When self-reviewing your own in-scope implementation work, fix all safe `supported-deterministic` and `supported-trace` in-scope issues before reporting, then re-run relevant validation.
- Do not fix reviewed code when the user asked for review-only output, the issue is out of scope, or the fix needs a product/architecture decision.
- Treat scouts, learned/project guidance, and corpus entries as hypothesis generators. Parent/verifier decides `supported-deterministic`, `supported-trace`, `plausible-but-unverified`, or `rejected`.
- Use the WIP failure-mode corpus only as a late, sparse, non-authoritative challenge pass after an unprimed review; keep an `outside-corpus` lane and reject forced fits.

## Choose Depth
Common triggers:
- **Agent self-review after implementation:** default to `standard` for non-trivial implementation; reserve `light` for small/mechanical changes (docs typos, trivial renames, test-only fixes). Escalate to `full` when high-risk triggers appear (auth/security, data loss, migrations, concurrency, public contracts, performance).
- **Major PR/feature mostly or fully done:** default to `standard`; use `full` for high-risk triggers below.
- **User requests review:** if the user names a specific depth (`audit`, `full`, `standard`, `light`), use it directly — do not infer a lower alternative. If no depth is specified, infer `light`, `standard`, `full`, or `audit` from risk and wording. State the chosen depth briefly.

Depths:
- `light`: local parent pass; no subagents by default. Use for small localized changes, docs/tests-only, mechanical refactors, or quick self-review.
- `standard`: compact impact map, project-native evidence where cheap, 1 medium triage reviewer or local triage, at most 2 targeted cheap scouts, clustering/dedupe, and verifier only for retained candidates.
- `full`: high-risk hybrid with a stronger impact/evidence lane, up to 2 medium triage reviewers, at most 3 targeted cheap scouts, bounded coverage-gap pass, and strong verification.
- `audit`: exhaustive or many-agent review only when explicitly requested.

Use `full` for auth/security, data loss, migrations/schema/config, concurrency/resource lifecycles, public APIs/contracts, performance-sensitive paths, broad cross-file changes, artifact/protocol contracts, or unclear intent.

For correctness-critical paths (state machines, financial/safety calculations, data integrity constraints, authz logic), escalate depth by one tier unless you have deterministic test coverage that proves the relevant edge states and failure modes. Tests written by the same author as the code have a blind spot: they prove the code does what was thought about, not what was missed. When such paths can't be tested deterministically (timing-dependent, requires complex integration setup, probabilistic), escalate regardless of any partial coverage — the review is the last line of defense.

If uncertain between two depths, choose the lower depth and escalate only when concrete risk appears — unless the user has explicitly requested the higher depth.

## Load Only What Applies
- Self-review, user-requested review, review-and-fix, or PR readiness path: read `workflows.md`.
- Standard/full/audit mechanics, impact mapping, evidence lanes, escalation rules, and cost controls: read `mode-details.md`.
- Deterministic tooling examples: read `tool-lanes.md` only when selecting tools or deciding which evidence lane fits a non-trivial review.
- Medium triage, scout, verifier, coverage-gap, and final report schemas/prompts: read `handoff-schemas.md` only when delegating or formatting structured handoffs.
- Future architecture ideas: read `future-ideas.md` only when planning changes to this review system, not during normal reviews.
- WIP corpus files: do not read by default. For standard/full review, after an unprimed pass, read only `wip/family-routing-table.md` when coverage looks weak or risk is high. Read other `wip/` files only for audit-style review or prompt-development work.

## Minimal Intake
1. Inspect the diff: use `git diff`, or `git diff HEAD` when staged changes may matter.
2. If there is no diff, review files the user named or files changed earlier in the session.
3. Identify change intent, touched subsystems, changed public contracts, changed tests, validation output, and high-risk triggers.
4. Tag change families and make an impact sketch. For `standard`/`full`, turn it into a compact impact map before delegation or final ranking.
5. Choose and state review depth.

## Verification and Reporting Rules
- Verify file/line anchors and referenced behavior against the current tree.
- Before keeping runtime, protocol, or environment findings, search local config for feature flags, compatibility settings, or test-stack defaults that intentionally change standard behavior.
- Before final ranking, cluster candidates by root cause, merge duplicates, and suppress symptom-only repeats.
- For `standard`/`full`, run a bounded coverage-gap check when high-risk change families lack inspection; it may add at most 2 candidates and those candidates still require verification.
- Do not turn generic tool output into review comments. Keep only findings with a diff-connected consequence and current-tree evidence.
- Report highest-value findings first, normally 1-5 inline unless the user asks for exhaustive review.
- If more verified supported issues exist, add `Additional supported findings` with concise grouped bullets; do not silently drop them.
- Include `Depth used`, change families, deterministic evidence run/skipped, validation/not-checked evidence, and no-findings summary when applicable.
- Put `plausible-but-unverified` concerns in a separate section only when they are useful and clearly labeled; otherwise omit them.

## Common Failure Modes
- “This is just a quick review, so no depth decision or impact map is needed.” Always scale and state depth; light should stay light, but non-trivial reviews need impact context.
- “I reviewed each file separately, so cross-file contracts are covered.” Add impact/caller tracing for changed contracts and unchanged consumers.
- “A tool reported it, so it is a review finding.” Only report diff-connected issues with consequence; suppress unrelated or pre-existing analyzer noise.
- “The cap says 5 findings, so I can ignore the rest.” Caps limit candidate generation and inline report size, not verified issue handling.
- “A subagent found it, so it is true.” Scouts only produce hypotheses; parent verification, clustering, and deduplication are mandatory.
- “Medium triage should investigate everything.” Medium triage routes work; targeted scouts investigate selected paths.
- “The coverage-gap pass should find more issues.” It only checks whether high-risk paths were not inspected; it is not a second broad review.
- “The failure-mode corpus names this pattern, so it must be relevant.” Use the corpus only as a late challenge pass; reject forced fits and prefer `outside-corpus` when the mapping is weak.
