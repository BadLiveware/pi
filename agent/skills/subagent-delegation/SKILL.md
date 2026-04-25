---
name: subagent-delegation
description: Use when work contains focused, low-coupling subtasks that can run independently, especially when a bounded task should run on a different enabled model than the current session.
---

# Subagent Delegation

Use this skill to decide what to delegate, how to bound it, and when to shift a bounded task to a more appropriate enabled model.

## Reach for This Skill When
- focused, low-coupling subtasks exist
- the current model is more capable or more scarce than a bounded subtask requires
- the current model may be insufficient for a select implementation, review, or reasoning subtask
- parallel analysis or search could speed the work up
- you need a bounded deliverable from a subagent

## Outcome
- delegated work with clear scope, deliverables, and post-integration validation
- explicit model choice matched to task difficulty, latency needs, quota pressure, and current enabled models
- task-based delegation when task tools are available

## Good Delegation Targets
- targeted code search
- isolated analysis
- Feynman research triage, such as prior-session recovery, paper lookup, or source comparison
- draft test cases
- alternative implementation ideas
- documentation synthesis
- repetitive mechanical checks where a bounded answer is enough

## Avoid Delegating When
- the task depends on a large amount of evolving local context
- multiple tasks will heavily conflict in the same files
- correctness depends on subtle coordination that is cheaper to keep local
- the integration and review effort would exceed the cost of doing the work directly

## Model Selection
When model choice matters, inspect local Pi config first, especially `~/.pi/agent/settings.json` and its `enabledModels` list. Use only enabled models. Do not hard-code a fixed model ladder in this skill; the available/preferred model set can change.

Choose based on the bounded subtask's actual needs:

- **Capability:** use a stronger enabled model for narrow work that needs deeper reasoning, higher implementation reliability, or adversarial review.
- **Cost/quota:** use a cheaper or less scarce enabled model for bounded routine work when it should be reliable enough.
- **Latency:** use a faster enabled model when quick turnaround matters and the task is well-scoped.
- **Quota partitioning:** treat `-spark` variants as faster variants with separate, more limited limits. Do not assume `-spark` means less intelligent; choose it when its speed and quota tradeoff fit the task.
- **Context isolation:** delegate to the same class of model only when isolation, parallelism, or specialized agent behavior clearly justifies it.

Default downshift rule: if the current session is using a top/expensive/scarce model, actively look for safe opportunities to delegate bounded routine work to an enabled model that is cheaper, faster, or less scarce while still reliable for the task.

Default upshift rule: if the current session is using a cheaper, faster, or more limited model, delegate select hard subtasks to a stronger enabled model when the bounded work needs it. Upshift only the hard piece; keep surrounding orchestration, file inspection, and straightforward edits on the current model when safe.

## Feynman Research Delegation
For research-heavy planning or source-sensitive work, prefer the namespaced Feynman agents when they fit:

- `feynman-researcher` for evidence gathering and source triage
- `feynman-verifier` for citation/source verification
- `feynman-reviewer` for adversarial research-artifact review
- `feynman-writer` for drafting from already-collected evidence

Use model overrides from the currently enabled models when launching these agents. For example, quick source triage can use a fast enabled model when quota allows; difficult verification or review may justify a stronger enabled model.

## Workflow
1. Define the exact subtask, expected output, acceptance criteria, and files or sources the subagent may inspect.
2. Decide whether delegation is for cheaper-model execution, faster-model execution, more-powerful-model execution, parallelism, specialized behavior, or context isolation.
3. Choose the enabled model that best fits the bounded subtask's capability, latency, cost, and quota needs.
4. If task tools are available, create or update a task for delegated work when that improves tracking. Use `TaskExecute` when it fits; use the `subagent` tool directly when you need a specific custom agent, model override, output file, async run, or parallel fan-out.
5. Keep prompts concrete, bounded, and limited to the context the subagent actually needs.
6. For planning research, ask for a small evidence brief with sources, confidence, and open questions rather than a broad report.
7. Review the result before integrating.
8. Re-validate after integration.

## Task-Based Delegation Guidance
- Prefer task-based delegation over one-off prompts when task tools are available and tracking matters.
- Delegate only bounded subtasks from the current in-scope phase or plan document.
- Reading a plan file for context is parent setup work, not a delegated task, unless plan analysis itself is the deliverable.
- Delegate concrete leaf tasks with a clear done state, not vague parent/container, bookkeeping-only, or catch-all tasks.
- Use dependencies to order delegated work safely and keep the parent agent responsible for integration, conflict resolution, and final validation.
- If using task execution with a model override, pick from current enabled models rather than stale or unavailable model names.

## Delegation Template

```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Model: <enabled model chosen for this bounded task, with cost/latency/quota/capability reason>
Constraints: <important rules>
```

## Example Subagent Calls

Easy bounded source triage:

```json
{
  "agent": "feynman-researcher",
  "task": "Find 3-5 primary sources for <topic>. Return a concise evidence table with URLs and open questions. Do not draft the final plan.",
  "model": "<fast enabled model if quota allows>"
}
```

Routine delegated analysis:

```json
{
  "agent": "worker",
  "task": "Inspect <files> and identify likely causes of <bug>. Do not edit files. Return hypotheses with file/line references.",
  "model": "<enabled model sufficient for routine analysis>"
}
```

Nuanced verification:

```json
{
  "agent": "feynman-verifier",
  "task": "Verify claims in .pi/feynman/drafts/<slug>-cited.md against the listed sources and write findings to .pi/feynman/notes/<slug>-verification.md.",
  "model": "<stronger enabled model if citation integrity is difficult>"
}
```

Upshift a hard implementation slice from a cheaper current session:

```json
{
  "agent": "worker",
  "task": "Implement the parser state transition described in .pi/plans/parser-fix.md. Limit edits to src/parser/*.ts and add focused tests. Return changed files and validation run.",
  "model": "<stronger enabled model for the hard slice>"
}
```
