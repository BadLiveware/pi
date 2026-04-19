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
- delegated work with clear task boundaries, expected deliverables, and post-integration re-validation

## Good Delegation Targets
- targeted code search
- isolated analysis
- draft test cases
- alternative implementation ideas
- documentation synthesis

## Avoid Delegating When
- the task depends on a large amount of evolving local context
- multiple tasks will heavily conflict in the same files
- correctness depends on subtle coordination that is cheaper to keep local

## Workflow
1. Define the exact subtask and expected output.
2. Choose a model appropriate to complexity.
3. Keep prompts concrete and bounded.
4. Review the result before integrating.
5. Re-validate with tests or other checks after integration.

## Delegation Template

```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Constraints: <important rules>
```
