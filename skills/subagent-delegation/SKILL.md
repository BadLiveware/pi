---
name: subagent-delegation
description: Splits work into bounded delegated tasks for subagents, choosing appropriate models and ensuring outputs are reviewed before integration.
---

# Subagent Delegation

Use this skill when work can be split into focused tasks that benefit from delegation or parallel execution.

## Goals
- Use subagents for narrow, low-coupling tasks
- Increase throughput without losing control
- Keep integration quality high

## Delegate Well-Scoped Tasks
Good candidates:
- targeted code search
- isolated analysis
- draft test cases
- alternative implementation ideas
- documentation synthesis

Avoid delegating when:
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
