---
name: code-review
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
- Do not fix reviewed code unless the user asked for review-and-fix or the current task scope includes implementation.

## When and How Deep
Common triggers:
- **Agent self-review after a medium/major change:** default to `light` unless the change touches high-risk areas.
- **Major PR/feature mostly or fully done:** default to `standard`; use `full` for high-risk triggers below.
- **User requests review:** infer `light`, `standard`, or `full` from risk and wording; state the chosen depth briefly.

Depths:
- `light`: local parent pass; no subagents by default. Use for small localized changes, docs/tests-only, mechanical refactors, or quick self-review.
- `standard`: hybrid review with 1 medium triage reviewer, at most 2 targeted cheap scouts, parent condensation, and a verifier only for retained candidates.
- `full`: high-risk hybrid with up to 2 medium triage reviewers, at most 3 targeted cheap scouts, deterministic evidence, and strong verification.
- `audit`: exhaustive or many-agent review only when explicitly requested.

Use `full` for auth/security, data loss, migrations/schema/config, concurrency/resource lifecycles, public APIs/contracts, performance-sensitive paths, broad cross-file changes, artifact/protocol contracts, or unclear intent.

## Intake
1. Inspect the diff: use `git diff`, or `git diff HEAD` when staged changes may matter.
2. If there is no diff, review files the user named or files changed earlier in the session.
3. Identify change intent, touched subsystems, changed public contracts, changed tests, validation output, and high-risk triggers.
4. Choose and state review depth. If uncertain between two depths, choose the lower depth and escalate only when concrete risk appears.

## Review Pipeline

### 1. Build a compact context packet
Capture only what reviewers need:
- changed files and short diff summary
- behavior or contract changes
- likely callers/dependents and unchanged files that may still be affected
- tests added/changed/missing
- validation results or missing validation
- relevant local conventions, config, and project guidance

### 2. Triage before scouting
For `light`, do a combined local pass and skip delegation unless a high-risk concern appears.

For `standard` or `full`, run medium triage before scouts. Medium reviewers route depth; they should not deep-dive every path.

Optional failure-mode routing: if `wip/family-routing-table.md` is present, use it only after an unprimed first pass and only when coverage looks weak or risk is high. Shortlist 2-5 families as a challenge pass, keep an `outside-corpus` lane, and treat corpus-suggested concerns more skeptically than unprompted concerns. The WIP corpus is heuristic, non-authoritative, and non-exhaustive; do not inject the whole corpus unless the user explicitly asks for audit-style review or prompt development.

Medium triage caps:
- max 5 direct findings
- max 3 escalation requests
- avoid style nits and generic advice
- stop once the scout target is clear

Triage output:
```json
{
  "direct_findings": [
    {"title": "...", "files": ["..."], "evidence": ["..."], "consequence": "...", "confidence": "low|medium|high"}
  ],
  "escalation_requests": [
    {"scout_type": "impact|caller-callee|test-gap|config-protocol|security-boundary|perf-resource", "target_files": ["..."], "target_symbols": ["..."], "reason": "...", "priority": "low|medium|high", "expected_failure_mode": "..."}
  ]
}
```

### 3. Run targeted semantic scouts
Launch cheap/fast scouts only for high-priority escalation requests or mandatory high-risk triggers. Scouts generate hypotheses; they do not write final review comments. If passing model overrides, use the subagent-delegation model-selection rules first.

Recommended scouts:
- **Impact/caller scout**: trace changed APIs/symbols to callers, dependents, migrations, config, artifacts, and unchanged files that should have changed.
- **Correctness-path scout**: trace changed control/data paths for invariant breaks, edge cases, state transitions, error handling, compatibility, changed contracts.
- **Test-gap scout**: map changed behavior to tests; flag missing coverage, weak assertions, unchanged tests that should change, and validation mismatch.
- **Config/protocol scout**: check feature flags, runtime config, compatibility modes, test-stack defaults, protocol assumptions, and environment-sensitive behavior.
- **Security-boundary scout**: inspect trust boundaries, authn/authz, injection, secrets, unsafe defaults, dependency or config exposure.
- **Performance/resource scout**: inspect algorithmic regressions, repeated IO/network calls, missed concurrency, hot-path bloat, cleanup leaks, unbounded memory.

Scout caps:
- one narrow question per scout
- max 3 candidates unless explicitly asked for exhaustive review
- omit candidates with no concrete path, file anchor, or consequence

### 4. Condense candidates
Before spending strong-model attention:
- cluster duplicates by root cause, affected symbol/path, and consequence
- merge supporting evidence from triage and scouts
- discard taste-based nits and low-confidence speculation
- preserve uncertainty and missing-evidence notes
- pass only condensed candidates, not raw transcripts, to the verifier

### 5. Reduce and verify
Before reporting:
- classify each candidate as `supported`, `plausible but unverified`, or `rejected`
- record whether each candidate came from `unprimed`, `corpus-suggested`, or `outside-corpus` reasoning
- verify file/line anchors and referenced behavior against the current tree
- before keeping runtime, protocol, or environment findings, search local config for feature flags, compatibility settings, or test-stack defaults that intentionally change standard behavior
- classify severity and confidence
- keep only the highest-value findings, normally 1-5 unless the user asks for exhaustive review

## Finding Format
Use this shape for each retained finding:

```md
- **Severity / confidence:** <critical|high|medium|low>, <high|medium|low>
  **Location:** `path:line`
  **Issue:** <what is likely wrong>
  **Consequence:** <how this can fail or why it matters>
  **Evidence:** <diff, caller, test output, local convention, or static/runtime signal>
  **Suggested fix:** <concrete direction, not a vague preference>
```

Also report:
- **Depth used:** `light`, `standard`, `full`, or `audit`.
- **Not checked:** commands, environments, or evidence that were unavailable.
- **No findings:** say so only after summarizing what was inspected and any validation gap.

## Scout Prompt Template
```md
Trace this diff for <semantic path / concern>. Use the context and escalation below. Return candidate issues only.

Context:
<context packet>

Escalation:
<target files/symbols, reason, expected failure mode>

Rules:
- Focus only on this concern.
- Do not write final review comments or edit files.
- Return at most 3 candidates.
- For each candidate include: category, title, semantic path, files/symbols, exact evidence, suspected consequence, confidence, and missing evidence.
- Mark uncertainty explicitly; omit weak speculation.
```

## Common Failure Modes
- “This is just a quick review, so no depth decision is needed.” Always scale and state depth; light should stay light.
- “I reviewed each file separately, so cross-file contracts are covered.” Add impact/caller tracing for changed contracts and unchanged consumers.
- “More comments means better review.” Optimize for signal-to-noise, not volume.
- “The model can infer runtime behavior.” Prefer actual test/build/benchmark/static-analysis evidence when available.
- “Repository context is always helpful.” Retrieve only context that changes review decisions.
- “A subagent found it, so it is true.” Scouts only produce hypotheses; parent verification and deduplication are mandatory.
- “Medium triage should investigate everything.” Medium triage routes work; targeted scouts investigate selected paths.
- “The failure-mode corpus names this pattern, so it must be relevant.” Use the corpus only as a late challenge pass; reject forced fits and prefer `outside-corpus` when the mapping is weak.
