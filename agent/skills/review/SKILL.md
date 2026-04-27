---
name: review
description: Use when reviewing changed code, pull request diffs, or implementation work for defects, risk, tests, maintainability, security, performance, or repository impact.
---

# Code Review

Review code as a high-signal risk assessment: scale effort to risk, find likely real issues, explain consequence, and suppress speculative noise.

## Core Rules
- Pick the cheapest review depth that can catch the likely risk; a 5-minute code change should not trigger a 10-minute review cycle.
- Prefer concern-specialized and cross-file review over file-only sharding; many important bugs are semantic, contract-related, or in unchanged consumers.
- Use deterministic signals when available: tests, typecheck/build output, linters, static analysis, coverage, benchmarks, CI logs, and grep/code search.
- Keep repository context selective: inspect touched contracts, nearby patterns, relevant guidance, and changed callers; do not flood every reviewer with generic context.
- Require evidence for each finding. If a claim depends on unavailable runtime evidence, mark it uncertain or omit it.
- Deduplicate and rank findings before presenting them. Fewer strong findings beat many weak comments.
- Use caps to control hypothesis generation, fanout, and report readability; never silently drop verified supported issues.
- When self-reviewing your own in-scope implementation work, fix all safe supported in-scope issues before reporting, then re-run relevant validation.
- Do not fix reviewed code when the user asked for review-only output, the issue is out of scope, or the fix needs a product/architecture decision.
- Treat scouts and corpus entries as hypothesis generators. Parent/verifier decides `supported`, `plausible but unverified`, or `rejected`.
- Use the WIP failure-mode corpus only as a late, sparse, non-authoritative challenge pass after an unprimed review; keep an `outside-corpus` lane and reject forced fits.

## Choose Depth
Common triggers:
- **Agent self-review after a medium/major change:** default to `light` unless high-risk triggers appear; fix supported in-scope issues found.
- **Major PR/feature mostly or fully done:** default to `standard`; use `full` for high-risk triggers below.
- **User requests review:** infer `light`, `standard`, or `full` from risk and wording; state the chosen depth briefly.

Depths:
- `light`: local parent pass; no subagents by default. Use for small localized changes, docs/tests-only, mechanical refactors, or quick self-review.
- `standard`: 1 medium triage reviewer, at most 2 targeted cheap scouts, parent condensation, and verifier only for retained candidates.
- `full`: high-risk hybrid with up to 2 medium triage reviewers, at most 3 targeted cheap scouts, deterministic evidence, and strong verification.
- `audit`: exhaustive or many-agent review only when explicitly requested.

Use `full` for auth/security, data loss, migrations/schema/config, concurrency/resource lifecycles, public APIs/contracts, performance-sensitive paths, broad cross-file changes, artifact/protocol contracts, or unclear intent.

If uncertain between two depths, choose the lower depth and escalate only when concrete risk appears.

## Load Only What Applies
- Self-review, user-requested review, review-and-fix, or PR readiness path: read `workflows.md`.
- Standard/full/audit mechanics, escalation rules, and cost controls: read `mode-details.md`.
- Medium triage, scout, verifier, and final report schemas/prompts: read `handoff-schemas.md` only when delegating or formatting handoffs.
- WIP corpus files: do not read by default. For standard/full review, after an unprimed pass, read only `wip/family-routing-table.md` when coverage looks weak or risk is high. Read other `wip/` files only for audit-style review or prompt-development work.

## Minimal Intake
1. Inspect the diff: use `git diff`, or `git diff HEAD` when staged changes may matter.
2. If there is no diff, review files the user named or files changed earlier in the session.
3. Identify change intent, touched subsystems, changed public contracts, changed tests, validation output, and high-risk triggers.
4. Choose and state review depth.

## Verification and Reporting Rules
- Verify file/line anchors and referenced behavior against the current tree.
- Before keeping runtime, protocol, or environment findings, search local config for feature flags, compatibility settings, or test-stack defaults that intentionally change standard behavior.
- Report highest-value findings first, normally 1-5 inline unless the user asks for exhaustive review.
- If more verified supported issues exist, add `Additional supported findings` with concise grouped bullets; do not silently drop them.
- Include `Depth used`, validation/not-checked evidence, and no-findings summary when applicable.

## Common Failure Modes
- “This is just a quick review, so no depth decision is needed.” Always scale and state depth; light should stay light.
- “I reviewed each file separately, so cross-file contracts are covered.” Add impact/caller tracing for changed contracts and unchanged consumers.
- “The cap says 5 findings, so I can ignore the rest.” Caps limit candidate generation and inline report size, not verified issue handling.
- “A subagent found it, so it is true.” Scouts only produce hypotheses; parent verification and deduplication are mandatory.
- “Medium triage should investigate everything.” Medium triage routes work; targeted scouts investigate selected paths.
- “The failure-mode corpus names this pattern, so it must be relevant.” Use the corpus only as a late challenge pass; reject forced fits and prefer `outside-corpus` when the mapping is weak.
