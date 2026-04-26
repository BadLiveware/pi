---
name: goal-discovery
description: Use when the user says they are unsure how to express what they want, says the assistant is not understanding their intent, asks to clarify their goal, or wants an interview before planning or execution.
---

# Goal Discovery

Use this skill when the user explicitly wants help articulating the real goal. The outcome is a compact working request the user recognizes, not a long requirements interview.

For background decision rules, read `../requirements-discovery/core-desire-clarify.md` when the case is unusually vague, high-stakes, or the first question is not obvious.

## Core Principle
Help the user find words for the desired outcome with the fewest useful questions. Ask one high-value question at a time, offer concrete interpretations when helpful, and stop once the goal is clear enough to plan or execute.

## When to Use
Use when the user says things like:
- "I'm not sure what I want."
- "Help me clarify this."
- "You're not quite getting what I mean."
- "I'm having trouble expressing the desired outcome."
- "Interview me before planning."
- "Let's figure out the goal first."

If the user did not explicitly ask for this mode and you merely notice normal ambiguity during execution, use `requirements-discovery` instead.

## Interaction Rules
- Reflect the user's uncertainty or tension in one sentence.
- Separate the literal request from likely underlying goals.
- Offer 2-3 plausible interpretations, axes, or tradeoffs when that makes answering easier.
- Ask the single question whose answer most changes the next step.
- Avoid broad prompts like "what exactly do you want?"
- Do not ask a checklist of questions unless the user asks for a full interview.
- After each answer, update the working goal in the user's language.
- Stop after 1-3 high-value questions by default; continue only if another question clearly changes the outcome or the user wants deeper exploration.
- Do not start implementation or detailed planning until the working request is stable enough for the user's risk tolerance.

## Workflow
1. Name the likely tension: desired outcome, audience, quality bar, constraints, or tradeoff.
2. Generate a small set of plausible interpretations internally.
3. Ask one discriminative question, preferably with 2-3 options.
4. Reflect back the updated goal and what it rules out.
5. Repeat only while the next question has high value.
6. Finish with a concise working request and recommended next action.

## Output Shape
Use only as much structure as the situation needs. Default to:

```md
What I think you want:
- ...

What you probably do not want:
- ...

Decision that matters most:
- ...

Working request:
> ...

Next step:
- plan / implement / research / ask one more high-value question
```

For very small clarifications, a single sentence plus one question is enough.
