---
name: subagent-delegation
description: Use when considering whether to delegate bounded work for parallelism, independent review, routine work on a cheaper or faster enabled model, or hard narrow work on a stronger enabled model.
---

# Subagent Delegation

Use this skill to decide whether to delegate, how to bound delegated work, and how to choose an appropriate enabled model without assuming a fixed provider or model ladder.

## Outcome
- delegate only work with a clear leaf scope and reviewable deliverable
- use subagents when parallelism, independence, specialization, or model rightsizing improves the result, unless a concrete avoid condition applies
- choose models from the current supported enabled set based on task needs, not stale or locally unsupported model names
- keep the parent agent responsible for integration, acceptance, and final validation

## Reach for This Skill When
- work can be split into focused, low-coupling subtasks
- routine search, inspection, summarization, or test drafting can run on a cheaper, faster, or less scarce enabled model
- a narrow hard slice needs stronger reasoning, implementation reliability, or adversarial review than the current model is likely to provide
- independent review, context isolation, or parallel scouting would improve confidence or coverage
- you are tempted to do everything locally on the current model even though bounded delegated work exists

## Delegation Decision Table

Use this as a dynamic guide. Substitute the actual currently enabled models, agents, tools, and provider limits from local Pi config and available delegation tooling; do not preserve these categories as fixed model names.

Default action: for non-trivial work with at least one bounded leaf task and cheap verification, delegate at least one scout, review, test-drafting, or implementation slice unless an avoid condition below applies. For truly trivial work, do it locally. For hard broad work where orchestration or validation is the hard part, do not pretend leaf delegation solves the risk; switch to a stronger parent model, ask for direction, or narrow the task.

| Work shape | Delegate? | Model direction | Why |
| --- | --- | --- | --- |
| Trivial one-file/read/edit task | Usually no | current model | Delegation and review overhead exceed the benefit. |
| Small batch of routine bounded search, inspection, or test ideas | Often yes if batching/parallelism saves scarce context or time | cheaper, faster, or less scarce enabled model | The output is easy to verify and does not need top capability. |
| Routine implementation or debugging analysis with clear files and acceptance criteria | Often yes | capable default enabled model; downshift from scarce top models when safe | Useful leaf work with manageable review cost. |
| Hard narrow implementation, correctness reasoning, or source-sensitive review | Often yes | stronger enabled model | Upshift only the difficult slice while keeping orchestration local. |
| Independent adversarial review of risky work | Yes when risk warrants | same-capability or stronger enabled model | Isolation and a second reasoning pass are the value; different model is optional. |
| Broad work with evolving requirements or large implicit context | Usually no | current model; delegate only narrow scouts/reviews | Context transfer and integration cost dominate. |
| Hard broad work where orchestration, safety, or validation is the hard part | Do not use leaf delegation as the main fix | stronger parent model, explicit user direction, or narrower scope | A subagent can help scout/review, but cannot own acceptance or compensate for unsafe orchestration. |
| Parallel source/repo triage | Yes when coverage or latency matters | cost-appropriate enabled model; use premium-speed models only when latency is worth the cost | Bounded independent lookups are easy to verify, but not always worth premium latency pricing. |

## Dynamic Model Selection

When model choice matters, call `list_pi_models` before passing a `model` override, downshifting, or upshifting unless the current session already inspected it recently. Prefer the tool over reading raw config because it combines current registry data, auth availability, enabled status, context limits, capability flags, cost/quota guidance, and local unsupported-model hints. If the tool is unavailable, fall back to inspecting local configuration such as `~/.pi/agent/settings.json` and its `enabledModels` list; if you do not inspect either source, omit the override and state why the default is acceptable.

Treat locally unsupported models as unavailable for delegation. `list_pi_models` excludes them by default; use `unsupported: "include"` or `unsupported: "only"` only for diagnostics, not as permission to select them. For model overrides, require both `support: yes` and `enabled: yes` in the catalog unless the user explicitly authorizes configuration changes. Do not choose a model just because it has `auth: yes`, and do not choose a model just because it appears in `enabledModels` if the catalog marks it unsupported.

When using the `subagent` tool, inspect available agents with `subagent {"action":"list"}` if names or capabilities are uncertain. Use only supported enabled models and configured agents unless the user explicitly authorizes changing configuration.

Do not hard-code a permanent model ladder in this skill. Providers, model names, pricing, quotas, speed, and quality change. Infer the choice from current catalog/config output, explicit user guidance, available metadata, model names, and the task's actual risk. Do not rely on remembered provider/model rankings as authoritative; treat remembered reputation only as weak evidence when current metadata is absent. If the relative ordering is unclear and the choice materially affects cost, quota, support, or correctness, ask or choose the safer default and state the assumption.

Choose by these dimensions:

- **Capability:** use a stronger enabled model for narrow work that needs deeper reasoning, higher implementation reliability, or adversarial review.
- **Cost/quota/scarcity:** use a cheaper or less scarce enabled model for bounded routine work when the output is easy to verify.
- **Latency:** use a faster enabled model when quick turnaround matters and the task is well-scoped.
- **Quota partitioning:** treat names such as `mini`, `flash`, `lite`, or provider-specific variants as signals to check speed/quota/cost tradeoffs, not proof of low intelligence. Treat `spark` as a premium very-low-latency signal, not as a cheap-model signal.
- **Context isolation:** use the same or similar capability class when the main benefit is independent review, fresh perspective, or parallelism rather than cheaper execution.
- **Tool/context needs:** prefer a model/agent combination that exists, is locally supported, has the required tools, and has enough context budget for the bounded prompt.

Default downshift rule: if the current session is using a top, expensive, slow, or scarce model, actively look for bounded routine work that can run on a cheaper, faster, or less scarce enabled model while still being reliable enough.

Default upshift rule: if the current session is using a cheaper, faster, smaller, or more limited model, delegate select hard subtasks to a stronger enabled model when the bounded work needs it. If a bounded correctness-sensitive slice is the likely failure point, either delegate/upshift that slice or record the concrete reason not to, such as no stronger enabled model, context cannot be packaged, or review cost exceeds benefit. Upshift only the hard piece; keep surrounding orchestration, file inspection, straightforward edits, and integration on the current model when safe.

Same-model rule: delegation does not have to use a different model. Use same-model or same-class delegation when independence, parallelism, specialized agent behavior, or context isolation is the reason.

## Anti-Rationalizations

Do not use these excuses to skip or misuse delegation:

- “I can just do it myself.” If non-trivial work contains a bounded routine subtask and verification is cheap, delegate or downshift at least one useful leaf task unless an avoid condition applies.
- “This is tiny.” For truly trivial work, keep it local; for a batch of tiny independent checks, delegate or parallelize when it saves scarce context or latency.
- “The strongest model is safest.” Do not spend scarce top-model quota on mechanical search, obvious summaries, or easy-to-verify routine work.
- “It is in `enabledModels`, so it is usable.” Enabled config is not enough; honor `list_pi_models` support status and do not select locally unsupported models.
- “It has `auth: yes`, so I can override to it.” Auth availability is not enough for model overrides; require `enabled: yes` too unless the user authorizes changing configuration.
- “The surrounding task is simple.” Upshift the narrow hard slice when that slice is correctness-sensitive or reasoning-heavy.
- “The subagent can figure out the scope.” Do not delegate vague ownership of the whole problem. Delegate leaf work with explicit files, sources, deliverables, and acceptance criteria.
- “A subagent result is enough.” The parent must review, integrate, and validate before treating the work as done.

## Good Delegation Targets
- targeted code search across specified files or directories
- isolated analysis with clear questions
- Feynman research triage, such as prior-session recovery, paper lookup, or source comparison
- draft test cases or edge-case lists
- alternative implementation ideas
- documentation synthesis from bounded sources
- repetitive mechanical checks where a bounded answer is enough
- independent adversarial review of a plan, diff, claim, or risky behavior

## Avoid Delegating When
- the task is a truly trivial single action that is faster to do locally than to prompt, wait, review, and integrate
- the task depends on a large amount of evolving local context that cannot be packaged cleanly
- multiple agents would heavily conflict in the same files
- correctness depends on subtle coordination that is cheaper to keep local
- the integration and review effort would exceed the cost of doing the work directly
- the delegated task would own final scope interpretation, acceptance, or release decisions
- hard broad work would be split across implementation subagents before requirements, invariants, integration plan, and validation strategy are stable

## Feynman Research Delegation
For research-heavy planning or source-sensitive work, prefer configured namespaced Feynman agents when they are available in the current environment:

- `feynman-researcher` for evidence gathering and source triage
- `feynman-verifier` for citation/source verification
- `feynman-reviewer` for adversarial research-artifact review
- `feynman-writer` for drafting from already-collected evidence

Treat these as possible agent names, not guaranteed names. Inspect available agents first when uncertain, and fall back to a configured general-purpose agent with a bounded research prompt when the Feynman agent is unavailable.

Use model overrides from models shown by `list_pi_models` as supported and enabled when launching these agents. Quick source triage can use a cheaper or less scarce supported model when cost matters, or a premium-speed model such as `-spark` only when latency is worth the higher cost; difficult verification or review may justify a stronger supported model.

## Workflow
1. Decide whether there is a bounded leaf task with small, stable context.
2. Check whether delegation provides parallelism, independence, specialization, cheaper/faster execution, stronger reasoning, or context isolation.
3. Compare prompt/wait/review/integration cost against doing it locally.
4. If delegation fits, define the exact subtask, expected output, acceptance criteria, and files or sources the subagent may inspect.
5. Discover available agents/models when uncertain; do not copy example names blindly. If an example uses a placeholder agent name, replace it with a configured agent returned by the current environment.
6. Choose the supported enabled model from `list_pi_models` that best fits the task's capability, latency, cost, quota, context, and tool needs. If `list_pi_models` is unavailable, use current config as a fallback and avoid unsupported or unverified model names.
7. If task tools are available, create or update a task for delegated work when tracking matters. Use `TaskExecute` when it fits; use the `subagent` tool directly when you need a custom agent, model override, output file, async run, or parallel fan-out.
8. Keep prompts concrete, bounded, and limited to the context the subagent actually needs.
9. Review the result before integrating.
10. Re-validate after integration.

## Task-Based Delegation Guidance
- Prefer task-based delegation over one-off prompts when task tools are available and tracking matters.
- Delegate only bounded subtasks from the current in-scope phase or plan document.
- Reading a plan file for context is parent setup work, not a delegated task, unless plan analysis itself is the deliverable.
- Delegate concrete leaf tasks with a clear done state, not vague parent/container, bookkeeping-only, or catch-all tasks.
- Use dependencies to order delegated work safely and keep the parent agent responsible for integration, conflict resolution, and final validation.
- If using task execution with a model override, pick from `list_pi_models` supported enabled models rather than stale, unsupported, or unavailable model names.

## Delegation Template

```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Model: <enabled model chosen for this bounded task, with cost/latency/quota/capability reason>
Constraints: <important rules>
Validation: <how the parent will check the result>
```

## Example Decisions

Example agent names are placeholders. Do not copy them as recommendations. Use configured agent names from the current environment; inspect them first when unsure.

Do not delegate trivial local work:
```md
Task: Check whether the currently open file mentions one config key.
Decision: Do it locally.
Reason: Single-file inspection is faster than prompting, waiting, and reviewing a subagent.
```

Downshift a routine bounded batch:
```json
{
  "agent": "<configured-agent-name-from-subagent-list>",
  "task": "Inspect docs/*.md and config/*.json for mentions of <key>. Do not edit files. Return matching files and one-line context for each match.",
  "model": "<cheaper or less scarce supported enabled model; use premium-speed models only if latency matters>"
}
```

Use same-model independent review when risk warrants:
```json
{
  "agent": "<configured-agent-name-from-subagent-list>",
  "task": "Review the parser refactor plan for correctness risks and missing edge cases. Do not edit files. Return blockers, likely failure modes, and focused test suggestions.",
  "model": "<same-capability or stronger enabled model; independence is the value>"
}
```

Upshift a hard implementation slice from a limited current model:
```json
{
  "agent": "<configured-agent-name-from-subagent-list>",
  "task": "Implement the parser state transition described in .pi/plans/parser-fix.md. Limit edits to src/parser/*.ts and add focused tests. Return changed files and validation run.",
  "model": "<stronger enabled model for the hard slice>"
}
```

Do not delegate broad context-heavy ownership:
```md
Bad: Ask a subagent to "fix the architecture and make the feature pass" while requirements are still changing.
Better: Keep orchestration local. Delegate a bounded scout: "Inspect src/state/*.ts and list state invariants the new feature must preserve. Do not edit files."
```

Do not use leaf delegation to hide an underpowered parent model:
```md
Task: Lead a risky cross-cutting migration where requirements, rollback strategy, and validation are unclear.
Decision: Do not proceed by delegating random slices. Switch to a stronger parent model, ask the user to narrow/approve the risk, or first delegate only a bounded discovery/review task.
Reason: The hard part is orchestration and acceptance, not a leaf implementation. If you cannot switch the parent model yourself, stop and ask the user to switch, narrow scope, or approve the risk instead of compensating with many leaf subagents.
```

## Skill Validation
When changing this skill, pressure-test at least these cases unless the gap is documented:
- trivial single-file task -> no delegation
- non-trivial routine bounded batch -> delegate and downshift when safe
- limited parent model plus hard narrow slice -> upshift or record a concrete reason not to
- hard broad migration -> do not solve with leaf implementation delegation
- example placeholders -> discover configured agent names instead of copying placeholders
- stale model ladder temptation -> call `list_pi_models` before model override
- unsupported-model temptation -> do not select a model that `list_pi_models` excludes or marks `support: no`
