---
name: subagent-delegation
description: Use when work contains focused, low-coupling subtasks such as isolated analysis, code search, draft tests, or alternative approaches that can be done independently.
---

# Subagent Delegation

Use this skill to decide what to delegate and how to bound it.

## Reach for This Skill When
- focused, low-coupling subtasks exist
- parallel analysis or search could speed the work up
- you need a bounded deliverable from a subagent

## Outcome
- delegated work with clear scope, deliverables, and post-integration validation
- task-based delegation when task tools are available

## Good Delegation Targets
- targeted code search
- isolated analysis
- Feynman research triage, such as prior-session recovery, paper lookup, or source comparison
- draft test cases
- alternative implementation ideas
- documentation synthesis

## Avoid Delegating When
- the task depends on a large amount of evolving local context
- multiple tasks will heavily conflict in the same files
- correctness depends on subtle coordination that is cheaper to keep local

## Workflow
1. Define the exact subtask, expected output, and acceptance criteria.
2. If task tools are available, create or update a task for the delegated work, set `agentType`, and use `TaskExecute` when available.
3. Keep prompts concrete, bounded, and limited to the context the subagent actually needs.
4. For planning research, ask for a small evidence brief with sources, confidence, and open questions rather than a broad report.
5. If model choice matters, inspect local pi config first. Prefer `gpt-5.3-codex` by default, `gpt-5.4` for difficult work, and `gpt-5.4-mini` or `gpt-5.2-codex` for easy work when available. Avoid local Gemma by default.
6. Review the result before integrating.
7. Re-validate after integration.

## Task-Based Delegation Guidance
- Prefer task-based delegation over one-off prompts when task tools are available.
- Delegate only bounded subtasks from the current in-scope phase or plan document.
- Reading a plan file for context is parent setup work, not a delegated task, unless plan analysis itself is the deliverable.
- Delegate concrete leaf tasks with a clear done state, not vague parent/container, bookkeeping-only, or catch-all tasks.
- Use dependencies to order delegated work safely and keep the parent agent responsible for integration, conflict resolution, and final validation.

## Delegation Template

```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Constraints: <important rules>
```
