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
- Requirements coverage: every required behavior maps to a task.
- Task granularity: each task is a coherent, independently testable/reviewable unit and plausible commit boundary.
- Acceptance criteria: tasks have concrete pass/fail criteria.
- Validation: commands or inspection checks are exact where knowable, with expected signals and explicit gaps.
- Placeholders: no TODO/TBD/fill-in-later/vague "handle edge cases" work.
- File specificity: paths or affected areas are exact enough for execution.
- Plan topology: broad plans have an ordered execution spine separated from reusable docs/runbooks and deferred design notes; mandatory implementation work is not hidden in reference files.
- Stardock readiness: when Stardock is expected, the plan can map the current execution item into a scoped brief/criteria/evidence flow without duplicating the full plan in `stardock-checklist.md`.
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
