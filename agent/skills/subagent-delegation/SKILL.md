---
name: subagent-delegation
description: Use when work contains focused, low-coupling subtasks that can run independently, especially when a bounded task should run on a cheaper or more powerful enabled model than the current session.
---

# Subagent Delegation

Use this skill to decide what to delegate, how to bound it, and when to shift a bounded task to a cheaper or more powerful enabled model.

## Reach for This Skill When
- focused, low-coupling subtasks exist
- the current model is more powerful than a bounded subtask requires
- the current model may be too weak for a select implementation, review, or reasoning subtask
- parallel analysis or search could speed the work up
- you need a bounded deliverable from a subagent

## Outcome
- delegated work with clear scope, deliverables, and post-integration validation
- explicit model choice matched to task difficulty, direction of handoff, and current enabled models
- task-based delegation when task tools are available

## Good Delegation Targets
- targeted code search
- isolated analysis
- Feynman research triage, such as prior-session recovery, paper lookup, or source comparison
- draft test cases
- alternative implementation ideas
- documentation synthesis
- repetitive mechanical checks where a cheaper model can produce a bounded answer

## Avoid Delegating When
- the task depends on a large amount of evolving local context
- multiple tasks will heavily conflict in the same files
- correctness depends on subtle coordination that is cheaper to keep local
- the integration and review effort would exceed the cost of doing the work directly

## Model Selection
When model choice matters, inspect local Pi config first, especially `~/.pi/agent/settings.json` and its `enabledModels` list. Use only enabled models.

Current preferred model ladder:

1. `openai-codex/gpt-5.3-codex-spark` — cheapest/easiest bounded work: simple code search, summarizing a few files, mechanical checks, draft test ideas, small documentation synthesis.
2. `openai-codex/gpt-5.3-codex` — default delegated leaf work: routine implementation analysis, focused debugging hypotheses, moderate code review, bounded research triage.
3. `openai-codex/gpt-5.4` — difficult delegated work: nuanced design review, tricky debugging, source-sensitive research synthesis, adversarial review.
4. `openai-codex/gpt-5.5` — reserve for genuinely hard work or when matching the current top model is necessary; do not use it merely out of habit.

Default downshift rule: if the current session is on `gpt-5.5`, actively look for safe opportunities to delegate bounded work to `gpt-5.3-codex-spark` or `gpt-5.3-codex`. Use `gpt-5.4` only when the cheaper models are likely to miss important nuance.

Default upshift rule: if the current session is on a cheaper model, delegate select hard subtasks to `gpt-5.4` or `gpt-5.5` when the bounded work needs stronger reasoning, higher implementation reliability, or adversarial review. Upshift only the hard piece; keep surrounding orchestration, file inspection, and straightforward edits on the cheaper model when safe.

## Feynman Research Delegation
For research-heavy planning or source-sensitive work, prefer the namespaced Feynman agents when they fit:

- `feynman-researcher` for evidence gathering and source triage
- `feynman-verifier` for citation/source verification
- `feynman-reviewer` for adversarial research-artifact review
- `feynman-writer` for drafting from already-collected evidence

Use model overrides from the enabled model ladder when launching these agents. For example, a quick source triage can usually run on `openai-codex/gpt-5.3-codex-spark` or `openai-codex/gpt-5.3-codex`; a difficult verification or review pass may justify `openai-codex/gpt-5.4`.

## Workflow
1. Define the exact subtask, expected output, acceptance criteria, and files or sources the subagent may inspect.
2. Decide whether delegation is for cheaper-model execution, more-powerful-model execution, parallelism, specialized behavior, or context isolation.
3. Choose the least powerful enabled model that should be reliable for the bounded subtask; when upshifting, choose the stronger model only for the narrow piece that needs it.
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
- If using task execution with a model override, pick from the current enabled model ladder rather than stale or unavailable model names.

## Delegation Template

```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Model: <enabled model chosen for this bounded task, with downshift/upshift reason>
Constraints: <important rules>
```

## Example Subagent Calls

Easy bounded source triage:

```json
{
  "agent": "feynman-researcher",
  "task": "Find 3-5 primary sources for <topic>. Return a concise evidence table with URLs and open questions. Do not draft the final plan.",
  "model": "openai-codex/gpt-5.3-codex-spark"
}
```

Routine delegated analysis:

```json
{
  "agent": "worker",
  "task": "Inspect <files> and identify likely causes of <bug>. Do not edit files. Return hypotheses with file/line references.",
  "model": "openai-codex/gpt-5.3-codex"
}
```

Nuanced verification:

```json
{
  "agent": "feynman-verifier",
  "task": "Verify claims in .pi/feynman/drafts/<slug>-cited.md against the listed sources and write findings to .pi/feynman/notes/<slug>-verification.md.",
  "model": "openai-codex/gpt-5.4"
}
```

Upshift a hard implementation slice from a cheaper current session:

```json
{
  "agent": "worker",
  "task": "Implement the parser state transition described in .pi/plans/parser-fix.md. Limit edits to src/parser/*.ts and add focused tests. Return changed files and validation run.",
  "model": "openai-codex/gpt-5.5"
}
```
