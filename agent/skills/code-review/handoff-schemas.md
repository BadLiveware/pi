# Code Review Handoff Schemas

Load this file only when delegating medium triage, scouts, verifier work, or when formatting structured handoffs.

## Compact Context Packet

```json
{
  "depth": "light|standard|full|audit",
  "change_summary": "...",
  "changed_files": ["..."],
  "changed_symbols": ["..."],
  "touched_subsystems": ["..."],
  "changed_contracts": ["..."],
  "changed_tests": ["..."],
  "validation": ["..."],
  "high_risk_flags": ["..."],
  "relevant_config_or_guidance": ["..."]
}
```

Keep this packet short and decision-relevant.

## Medium Triage Prompt

```md
Review this change as medium triage, not final reviewer and not deep scout.

Context:
<context packet>

Rules:
- Broad pass only; route depth and identify concrete risks.
- Max 5 direct findings and max 3 escalation requests.
- Avoid style nits and generic advice.
- Stop once the scout target is clear.
- If using the WIP corpus, do an unprimed first pass first and keep outside-corpus concerns.

Return JSON with direct_findings and escalation_requests.
```

## Medium Triage Output

```json
{
  "direct_findings": [
    {
      "title": "...",
      "files": ["..."],
      "symbols": ["..."],
      "evidence": [{"file": "...", "lines": "...", "reason": "..."}],
      "consequence": "...",
      "confidence": "low|medium|high",
      "origin": "unprimed|corpus-suggested|outside-corpus"
    }
  ],
  "escalation_requests": [
    {
      "scout_type": "impact|caller-callee|test-gap|config-protocol|security-boundary|perf-resource",
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
- Do not write final review comments or edit files.
- Return at most 3 candidates.
- For each candidate include category, title, semantic path, files/symbols, exact evidence, suspected consequence, confidence, and missing evidence.
- Mark uncertainty explicitly; omit weak speculation.
```

## Scout Output

```json
{
  "candidates": [
    {
      "category": "impact|correctness|tests|config|security|performance|maintainability",
      "title": "Changed function contract may break existing caller",
      "semantic_path": ["contract changed", "caller still assumes old behavior"],
      "files": ["src/a.ts", "src/b.ts"],
      "symbols": ["parseUser", "importUsers"],
      "evidence": [{"file": "src/a.ts", "lines": "44-61", "reason": "return behavior changed"}],
      "suspected_consequence": "runtime exception on malformed input",
      "confidence": "low|medium|high",
      "missing_evidence": ["no malformed-row test found"],
      "origin": "unprimed|corpus-suggested|outside-corpus"
    }
  ]
}
```

## Verifier Output

```json
{
  "id": "...",
  "source_ids": ["..."],
  "decision": "supported|plausible but unverified|rejected",
  "severity": "critical|high|medium|low|null",
  "confidence": "high|medium|low",
  "origin": "unprimed|corpus-suggested|outside-corpus",
  "title": "...",
  "evidence": [{"file": "...", "lines": "...", "reason": "..."}],
  "reasoning_summary": "...",
  "remaining_uncertainty": ["..."]
}
```

Verifier rules:
- reject candidates without concrete path, credible consequence, or evidence
- check local config before keeping runtime/protocol/environment claims
- apply extra skepticism to `corpus-suggested` candidates
- prefer `outside-corpus` over forced corpus matches
- deduplicate by root cause

## Final Finding Format

```md
- **Severity / confidence:** <critical|high|medium|low>, <high|medium|low>
  **Location:** `path:line`
  **Issue:** <what is likely wrong>
  **Consequence:** <how this can fail or why it matters>
  **Evidence:** <diff, caller, test output, local convention, or static/runtime signal>
  **Suggested fix:** <concrete direction, not a vague preference>
```

Also report depth used, validation/not-checked evidence, fixes applied for self-review/review-and-fix, and additional supported findings when more verified issues exist than fit inline.
