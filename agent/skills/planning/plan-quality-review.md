# Plan Quality Review

Use this prompt with a subagent for moderately complicated plans before execution, especially when the plan spans multiple files, touches public contracts, changes data or infrastructure behavior, or will guide another agent.

```markdown
You are reviewing an implementation plan before execution.

Plan: <path or pasted plan>
Relevant requirements/spec: <path or summary>
Repository context: <key files or constraints>

Check only issues that would cause incorrect implementation, blocked execution,
unreviewable changes, unsafe changes, or validation gaps.

Review categories:
- Semantic contract: for split plans, README states domain meaning, current/desired behavior, invariants, scope, compatibility, examples, and whole-change acceptance without embedding execution mechanics.
- Requirements coverage: every required semantic behavior maps to a `work-breakdown.md` node or explicit non-goal, and every node references what it implements.
- Task granularity: each task is a coherent, independently testable/reviewable unit and plausible commit boundary.
- Acceptance criteria: tasks have concrete pass/fail criteria.
- Validation: commands or inspection checks are exact where knowable, with expected signals and explicit gaps.
- Placeholders: no TODO/TBD/fill-in-later/vague "handle edge cases" work.
- File specificity: paths or affected areas are exact enough for execution.
- Plan topology: broad plans separate semantic `README.md`, executable `work-breakdown.md`, and supporting context; dependencies and ownership—not README sections or file numbering—determine order, and mandatory work is not duplicated or hidden in reference files.
- Stardock readiness: when Stardock is expected, the plan can compile into arbitrary report, research, test, decision, implementation, or promotion jobs with explicit dependencies, observable acceptance, and optional ownership, resources, attempt bounds, and validation. Incremental draft/upsert batches must not become topology, and execution waits for a successful seal. Integration, combined validation, and delivery are explicit nodes when required; nodes must not imply separate PRs or mandatory code production.
- Artifact hygiene: produced code/docs/generated outputs must not mention plan/stage/checklist metadata unless the product domain requires it.
- Safety: destructive, irreversible, credentialed, or externally visible actions are called out for approval.

Output:
## Plan Review

**Status:** Approved | Issues Found

**Blocking issues:**
- [section/task]: [specific issue] — [why it blocks execution]

**Advisory improvements:**
- [specific improvement]
```

Approve unless the plan has serious gaps. Do not block on style preferences or optional refinements.
