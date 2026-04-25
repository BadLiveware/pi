# Subagent Delegation Validation Scenarios

Use these when changing `subagent-delegation/SKILL.md`. The main skill keeps decision-critical rules inline; this file preserves examples and regression scenarios without loading them for normal delegation decisions.

## Required Behavior Tests
Pressure-test at least these cases, unless the validation gap is recorded:

1. **Trivial local work** -> no delegation.
   - Scenario: check whether one open README mentions one config key.
   - Expected: do it locally because delegation overhead dominates.

2. **Routine bounded batch** -> delegate/downshift when safe.
   - Scenario: inspect `docs/*.md` and `config/*.json` for a key and return matches.
   - Expected: delegate when batching saves time/context; use cheaper or less scarce supported enabled model if available.

3. **Stale/unsupported model temptation** -> call `list_pi_models`.
   - Scenario: remembered `openai-codex/gpt-5.1-codex-mini` sounds cheap.
   - Expected: reject stale/unsupported model; choose only `support: yes` + `enabled: yes`, or omit override/record gap.

4. **Spark temptation** -> do not treat premium-speed as cheap.
   - Scenario: cost-sensitive routine docs search and `gpt-5.3-codex-spark` is enabled.
   - Expected: avoid Spark unless latency is worth premium cost.

5. **Hard narrow slice on limited parent** -> upshift only the slice.
   - Scenario: one parser state-transition task is correctness-sensitive; files and acceptance criteria are clear.
   - Expected: delegate/upshift that slice to a stronger supported enabled model; keep orchestration/integration local.

6. **Hard broad migration** -> do not delegate random implementation slices.
   - Scenario: requirements, rollback, and validation are unclear.
   - Expected: strengthen/narrow parent work or delegate only bounded discovery/review.

7. **Placeholder agent names** -> inspect configured agents.
   - Scenario: example uses `<configured-agent-name>` and actual agents are unknown.
   - Expected: inspect available agents before launch; do not copy placeholders or guess names.

## Example Decisions

Do not delegate trivial local work:
```md
Task: Check whether the currently open file mentions one config key.
Decision: Do it locally.
Reason: Single-file inspection is faster than prompting, waiting, and reviewing a subagent.
```

Downshift routine bounded work:
```json
{
  "agent": "<configured-agent-name>",
  "task": "Inspect docs/*.md and config/*.json for mentions of <key>. Do not edit files. Return matching files and one-line context for each match.",
  "model": "<cheaper or less scarce supported enabled model; use premium-speed only if latency matters>"
}
```

Use independent review when risk warrants:
```json
{
  "agent": "<configured-agent-name>",
  "task": "Review the parser refactor plan for correctness risks and missing edge cases. Do not edit files. Return blockers, likely failure modes, and focused test suggestions.",
  "model": "<same-capability or stronger supported enabled model; independence is the value>"
}
```

Upshift a hard slice from a limited current model:
```json
{
  "agent": "<configured-agent-name>",
  "task": "Implement the parser state transition described in the current task. Limit edits to src/parser/*.ts and add focused tests. Return changed files and validation run.",
  "model": "<stronger supported enabled model for the hard slice>"
}
```

Do not use leaf delegation to hide an underpowered parent model:
```md
Task: Lead a risky cross-cutting migration where requirements, rollback, and validation are unclear.
Decision: Do not delegate random slices. Switch to a stronger parent model, narrow scope, or first delegate only bounded discovery/review.
Reason: The hard part is orchestration and acceptance, not a leaf implementation.
```
