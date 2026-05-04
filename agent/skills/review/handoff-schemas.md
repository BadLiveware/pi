# Code Review Handoff Schemas

Load this file only when delegating medium triage, scouts, verifier work, coverage-gap work, or when formatting structured handoffs.

## Artifact Location Policy

- Do not let review agents write findings into the reviewed repository root.
- Prefer `output: false` for reviewer/scout/verifier subagents unless you intentionally want saved artifacts.
- When artifacts are useful, route them under `.pi/review/<review-name>/` in the reviewed repo, using a short sanitized review name such as the branch, PR number, audit name, or timestamp.
- Use specific filenames such as `.pi/review/<review-name>/triage.json`, `.pi/review/<review-name>/scout-impact.json`, `.pi/review/<review-name>/verified-findings.json`, or `.pi/review/<review-name>/review.md`.
- Use `{chain_dir}` or another temp/dedicated artifact directory only when repo-local `.pi/review/` artifacts are not desired or the review is outside a normal repository.
- Avoid root-level cwd-relative filenames like `review.md`, `findings.json`, or `audit.md` when the subagent cwd is the target repo; they pollute the repo under review.
- In final output, mention artifact paths only when artifacts were intentionally created.

## Impact Map

```json
{
  "change_families": ["api-contract"],
  "changed_symbols": ["parseUser"],
  "caller_targets": ["src/importUsers.ts"],
  "callee_targets": ["src/validation.ts"],
  "test_targets": ["tests/importUsers.test.ts"],
  "config_targets": ["config/runtime.ts"],
  "schema_or_doc_targets": ["docs/api.md"],
  "contract_risks": ["parseUser now throws instead of returning null"],
  "unchanged_consumers_to_inspect": ["src/batchJob.ts"]
}
```

Keep impact maps compact. They exist to route review effort, not to document every file in the repository.

## Compact Context Packet

```json
{
  "depth": "light|standard|full|audit",
  "change_summary": "...",
  "change_families": ["api-contract", "test-only"],
  "changed_files": ["..."],
  "impact_map": {"...": "..."},
  "changed_tests": ["..."],
  "validation": ["..."],
  "deterministic_evidence": [
    {"lane": "A", "command_or_trace": "npm run typecheck", "result": "passed"}
  ],
  "tool_lanes_skipped": [
    {"lane": "B", "reason": "no configured rules; broad scan would be noisy"}
  ],
  "high_risk_flags": ["..."],
  "relevant_config_or_guidance": ["..."]
}
```

Keep this packet short and decision-relevant. Prefer snippets and paths anchored to the impact map over full-file dumps.

## Medium Triage Prompt

```md
Review this change as medium triage, not final reviewer and not deep scout.

Context:
<context packet>

Rules:
- Broad pass only; route depth and identify concrete risks.
- Use the impact map to check changed contracts, callers, tests, and config paths.
- Return candidate issues and escalation requests, not user-facing comments.
- Max 5 direct candidates and max 3 escalation requests.
- Avoid style nits and generic advice.
- Stop once the scout target is clear.
- If using the WIP corpus, do an unprimed first pass first and keep outside-corpus concerns.

Return JSON with direct_candidates and escalation_requests.
```

## Medium Triage Output

```json
{
  "direct_candidates": [
    {
      "id": "T1",
      "title": "...",
      "category": "impact|correctness|tests|config|security|performance|maintainability",
      "files": ["..."],
      "symbols": ["..."],
      "evidence": [{"file": "...", "lines": "...", "reason": "..."}],
      "consequence": "...",
      "confidence": "low|medium|high",
      "support_type": "supported-deterministic|supported-trace|plausible-but-unverified",
      "needs_verification": true,
      "origin": "unprimed|corpus-suggested|outside-corpus"
    }
  ],
  "escalation_requests": [
    {
      "scout_type": "impact-caller|correctness-path|test-gap|config-protocol|security-boundary|perf-resource",
      "target_files": ["..."],
      "target_symbols": ["..."],
      "reason": "...",
      "priority": "low|medium|high",
      "expected_failure_mode": "..."
    }
  ]
}
```

## Scout Prompt

```md
Trace this diff for <semantic path / concern>. Use the context and escalation below. Return candidate issues only.

Context:
<context packet>

Escalation:
<target files/symbols, reason, expected failure mode>

Rules:
- Focus only on this concern.
- Use impact-map targets and deterministic evidence already known.
- Do not write final review comments or edit files.
- Return at most 3 candidates.
- For each candidate include category, title, semantic path, files/symbols, exact evidence, suspected consequence, support type, confidence, and missing evidence.
- Mark uncertainty explicitly; omit weak speculation.
```

## Scout Output

```json
{
  "candidates": [
    {
      "id": "S1",
      "category": "impact|correctness|tests|config|security|performance|maintainability",
      "title": "Changed function contract may break existing caller",
      "semantic_path": ["contract changed", "caller still assumes old behavior"],
      "files": ["src/a.ts", "src/b.ts"],
      "symbols": ["parseUser", "importUsers"],
      "evidence": [{"file": "src/a.ts", "lines": "44-61", "reason": "return behavior changed"}],
      "suspected_consequence": "runtime exception on malformed input",
      "support_type": "supported-deterministic|supported-trace|plausible-but-unverified",
      "confidence": "low|medium|high",
      "missing_evidence": ["no malformed-row test found"],
      "origin": "unprimed|corpus-suggested|outside-corpus"
    }
  ]
}
```

## Candidate Clustering Output

```json
{
  "clusters": [
    {
      "id": "C1",
      "root_cause": "parseUser contract changed but batch importer still assumes null return",
      "source_candidate_ids": ["T1", "S1"],
      "representative_candidate": "S1",
      "dedupe_reason": "same changed contract and caller failure path",
      "suppressed_symptoms": ["missing test for malformed row"]
    }
  ]
}
```

## Verifier Output

```json
{
  "id": "V1",
  "source_ids": ["T1", "S1"],
  "decision": "supported-deterministic|supported-trace|plausible-but-unverified|rejected",
  "severity": "critical|high|medium|low|null",
  "confidence": "high|medium|low",
  "origin": "unprimed|corpus-suggested|outside-corpus",
  "title": "...",
  "evidence": [{"file": "...", "lines": "...", "reason": "..."}],
  "deterministic_evidence": [
    {"lane": "D", "command_or_trace": "pytest tests/test_import.py::test_malformed_row", "result": "failed"}
  ],
  "reasoning_summary": "...",
  "remaining_uncertainty": ["..."]
}
```

Verifier rules:
- reject candidates without concrete path, credible consequence, or evidence
- confirm file/line anchors against the current tree
- check local config before keeping runtime/protocol/environment claims
- classify deterministic tool/test/compiler evidence as `supported-deterministic`
- classify anchored caller/config/schema traces without runtime failure as `supported-trace`
- keep semantic-only concerns as `plausible-but-unverified` only when useful
- apply extra skepticism to `corpus-suggested` candidates
- prefer `outside-corpus` over forced corpus matches
- deduplicate by root cause

## Coverage-gap Prompt

```md
You are not looking for random more issues.
You are checking whether important risk areas were never adequately inspected.

Context:
<context packet>

Already inspected:
<clusters and verified findings>

Return at most 2 candidate findings only if a specific coverage gap plausibly hides a serious issue.
Each candidate must name the missing coverage path, affected change family, and evidence needed next.
```

## Coverage-gap Output

```json
{
  "coverage_gaps": [
    {
      "id": "G1",
      "change_family": "config-protocol",
      "missing_coverage_path": "new batching config was changed but receiver compatibility config was not inspected",
      "candidate_title": "...",
      "files_or_symbols_to_check": ["..."],
      "why_it_matters": "...",
      "next_evidence_needed": ["search receiver config", "run targeted compatibility test"]
    }
  ]
}
```

## Final Finding Format

Standard / full / audit:

```md
- **Severity / confidence / evidence:** <critical|high|medium|low>, <high|medium|low>, <supported-deterministic|supported-trace>
  **Location:** `path:line`
  **Issue:** <what is likely wrong>
  **Consequence:** <how this can fail or why it matters>
  **Evidence:** <diff, caller, test output, local convention, or static/runtime signal>
  **Suggested fix:** <concrete direction, not a vague preference>
```

Light (compact form):

```md
- `path:line` — <issue>. <consequence>. (<evidence label>)
```

Use the compact form when the review is `light` or when a self-review/review-and-fix turn produces a short finding list and the longer fields would be filler. Switch to the full form when severity, confidence, evidence detail, or suggested fix add real signal.

Also report depth used (for non-light), change families, deterministic evidence run/skipped, validation/not-checked evidence, fixes applied for self-review/review-and-fix, plausible-but-unverified risks when useful, and additional supported findings when more verified issues exist than fit inline.
