---
name: expected-value-decision-making
description: Use when choosing whether to spend more effort, verify, search, ask a question, delegate, use an expensive tool/model, continue iterating, or stop.
---

# Expected-Value Decision Making

Use this skill to choose the action with the highest expected net value, not the action that merely looks most thorough.

## Core Rule
Before a nontrivial next step, compare the likely value of available actions:

```text
expected net value ~= probability of useful improvement × impact of improvement - cost - downside risk
```

Use rough buckets, not fake precision. Low/medium/high is enough.

## When to Use
Use when deciding between:
- answer now vs investigate more
- verify vs proceed
- ask a clarifying question vs assume
- cheap inspection vs expensive tool/model/delegation
- broad search vs narrow search
- one more iteration vs stop

This is especially important when mistakes and extra work have asymmetric costs.

## Decision Rubric
For each plausible action, estimate:
- **Gain:** how much the final result could improve if the action helps
- **Chance:** how likely the action is to produce useful new information or reduce risk
- **Cost:** tokens, latency, tool calls, money, complexity, or user friction
- **Downside:** harm if the action is skipped, wrong, destructive, misleading, or wastes scarce resources
- **Cheaper substitute:** whether a smaller check captures most of the value

Choose the action with the best net value. Stop when no available next step is likely to change the final result enough to justify its cost.

## Effort Scaling
Spend more effort when:
- the cost of being wrong is high
- uncertainty is high and material
- a cheap check can substantially reduce risk
- the action may prevent irreversible, public, security, data-safety, or expensive mistakes

Stop or answer directly when:
- the task is low-stakes or stable knowledge
- further work is unlikely to change the answer
- checks are expensive relative to likely benefit
- additional work is mostly cosmetic or performative

Do not equate more work with better work.

## Common Patterns
- **Current or account-specific facts:** quick source/tool checks often have high value because stale information is likely and check cost is low.
- **Stable basic explanations:** answer directly unless the user asks for recent evidence.
- **Risky code edits:** run the smallest test or inspection that can falsify the current plan before broad cleanup.
- **Repeated research:** stop when new sources are redundant and conclusions no longer change.
- **Model/tool choice:** prefer cheap local inspection before expensive tools, but spend more when a small extra cost prevents a high-risk error.
- **Skill adherence tests:** do not skip cheap validation when a broken skill could repeatedly shape future behavior.

## Output Guidance
Usually apply the rubric silently and act. Expose a compact rationale only when the tradeoff is non-obvious, user-visible, or affects cost/risk:

```md
EV check: likely high risk reduction, low cost -> running focused test first.
```

Avoid long probability tables unless the user asks.

## Failure Modes
- Abstractly saying "use expected value" without choosing a concrete next action.
- Fake numerical precision that hides uncertainty.
- Over-searching because thoroughness looks good.
- Under-verifying because all cost is treated as bad.
- Ignoring stakes: spending the same effort on trivial and high-impact decisions.
- Forgetting cheaper substitutes before expensive tools or broad work.

## Editing This Skill
When changing this skill, test examples in `validation-scenarios.md`, including a case where extra checking is worth it and a case where stopping is correct.
