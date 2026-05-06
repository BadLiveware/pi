---
name: subagent-delegation
description: Use when considering whether to delegate bounded work for parallelism, independent review, routine work on a cheaper or faster enabled model, or hard narrow work on a stronger enabled model.
---

# Subagent Delegation

Use this skill to decide whether to delegate, what to delegate, and which supported enabled model to use.

## Core Rules
- Delegate only bounded leaf work with stable context and a reviewable deliverable.
- Do not delegate final scope interpretation, acceptance, release decisions, integration ownership, or final validation.
- Parent agent must review subagent output, integrate deliberately, and validate before treating work as done.
- Do not use leaf implementation delegation to compensate for unclear requirements, unsafe orchestration, or missing validation strategy.
- For non-trivial work with a bounded subtask and cheap verification, delegate at least one useful scout, review, test-drafting, or implementation slice unless an avoid condition applies.

## Decision Tree
1. **Is there a bounded leaf task?**
   - trivial single action -> do it locally
   - broad/unclear work -> clarify, plan, narrow, or delegate only discovery/review
2. **Would delegation add real value?**
   - useful value: parallelism, coverage, fresh review, context isolation, specialization, cheaper routine execution, or stronger reasoning for a hard slice
   - no real value or review/integration cost exceeds benefit -> do it locally
3. **Is it safe to delegate?**
   - no if context cannot be packaged cleanly, agents would conflict heavily, or the subagent would own final decisions
4. **Choose the branch:**
   - routine bounded search/inspection/summary/test ideas -> downshift to cheaper or less scarce supported enabled model when safe
   - hard narrow correctness/reasoning/review slice -> upshift that slice to a stronger supported enabled model
   - independent review/context isolation -> same-model or same-class delegation is valid
   - broad risky work -> parent strengthens requirements/validation; subagents may scout or review only

## Model Selection
Agent files may define default models. Use the agent default when it fits the task; choose an explicit override only when capability, cost/quota/scarcity, latency, or context-window needs materially favor a different enabled model.

Before passing a model override, downshifting, or upshifting, call `list_pi_models` unless the current session already inspected it recently.

Selection rules:
- choose rows with `support: yes` and `enabled: yes` unless the user explicitly authorizes configuration changes
- `auth: yes` only means credentials exist; it is not enough for overrides
- models excluded or marked `support: no` are unavailable; use `unsupported: "include"` or `unsupported: "only"` only for diagnostics
- `spark` means premium very-low-latency, not cheap; use Spark only when speed is worth the cost
- if `list_pi_models` is unavailable, inspect current config such as `~/.pi/agent/settings.json`; if still uncertain, omit the override and state why the default is acceptable
- do not hard-code model ladders in prompts; provider support, cost, quota, speed, and quality change
- avoid scarce or credit-limited providers when an enabled Codex/default model is suitable; use provider-specific models only when their capability is worth the cost or the user asks for them
- when choosing among Codex models, prefer `openai-codex/gpt-5.4` as the normal default, `openai-codex/gpt-5.4-mini` for simple/cheap tasks, and reserve `openai-codex/gpt-5.5` for very important or high-stakes work

Choose by capability, cost/quota/scarcity, latency, context window, tool needs, and whether independence rather than model difference is the value.

## Agent Discovery
When using the `subagent` tool, inspect available agents with `subagent {"action":"list"}` if names or capabilities are uncertain. Example agent names are placeholders; replace them with configured agents from the current environment.

For research-heavy or source-sensitive work, prefer configured researcher/verifier/reviewer/writer-style agents when available; otherwise use a configured general-purpose agent with a bounded prompt.

## Workflow
1. Define the subtask, deliverable, acceptance criteria, allowed files/sources, and parent validation.
2. Discover agents/models when uncertain; do not copy placeholders or stale model names.
3. Choose a supported enabled model from `list_pi_models` when using a model override.
4. Use `TaskExecute` for task-tracked delegation when it fits; use `subagent` directly for custom agents, model overrides, output files, async runs, or parallel fan-out.
5. Keep prompts concrete and limited to context the subagent actually needs.
6. Review the result, integrate deliberately, and re-validate.

## Delegation Template
```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Model: <supported enabled model, with cost/latency/quota/capability reason>
Constraints: <important rules>
Validation: <how the parent will check the result>
```

## Common Failure Modes
- “I can just do it myself.” For non-trivial bounded work, delegate/downshift one useful leaf unless an avoid condition applies.
- “The strongest model is safest.” Do not spend scarce top-model quota on mechanical, easy-to-verify work.
- “It is enabled/authenticated, so it is usable.” Require catalog `support: yes` and `enabled: yes`.
- “Spark is cheap because it is fast.” Spark is premium latency.
- “The subagent can figure out scope.” Delegated work needs explicit files, sources, deliverables, and acceptance criteria.
- “The subagent result is enough.” Parent validation is mandatory.

## Editing This Skill
When changing this skill, test the scenarios in `validation-scenarios.md`.
