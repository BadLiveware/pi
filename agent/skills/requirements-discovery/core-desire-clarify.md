# Core Desire Clarification

Use this reference when a request may not express the user's real goal, or when the user explicitly asks for help articulating what they want.

## Principle
Clarify only on material uncertainty, and choose the smallest question that most reduces uncertainty about the user's real goal.

## Passive vs Active Triggers
- **Passive trigger**: you notice ambiguity while doing normal work. Use `requirements-discovery`; ask only when the missing detail would materially change behavior, risk, architecture, UX, data safety, validation, or scope.
- **Active trigger**: the user says they are struggling to express what they want, says the assistant is not understanding, asks to clarify the goal, or wants an interview before planning/execution. Use `goal-discovery`; the user has invited a short clarification loop.

## Clarification Policy
1. Separate the literal ask from the likely underlying goal.
2. Internally list the top 2-4 plausible interpretations.
3. Identify the one missing variable that most changes the next action.
4. Ask one narrow question about that variable.
5. Offer 2-4 concrete options when options reduce user effort.
6. Stop asking once the remaining ambiguity is low-risk enough to proceed.
7. Before major execution, summarize the inferred goal and key assumptions.

## Question Quality
Good questions:
- partition plausible intents sharply
- change the plan, implementation, validation, or output if answered differently
- are easy for the user to answer
- avoid making the user invent a taxonomy from scratch

Poor questions:
- "Can you clarify?"
- "What exactly do you want?"
- broad multi-question checklists
- questions about nice-to-have details when the safe path is obvious

## Triage Missing Details
- **Must know**: wrong assumption would cause rework, unsafe behavior, public contract changes, data loss, misleading output, or the wrong product direction. Ask.
- **Useful to know**: answer may improve quality but the default is safe. Ask only if cheap and high-value; otherwise state the assumption.
- **Nice to know**: does not materially affect the next step. Infer, defer, or ignore.

## Active Goal-Discovery Loop
When the user explicitly asks for help expressing the goal:
1. Reflect the tension or uncertainty in one sentence.
2. Offer 2-3 plausible interpretations or axes.
3. Ask the single highest-value question.
4. After each answer, update the working goal in the user's language.
5. Continue only while the next question has high value; usually stop after 1-3 questions unless the user wants deeper exploration.
6. Finish with a compact working request and proposed next step.

Suggested output:

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

## Proceeding Under Uncertainty
If the task is low-risk enough to proceed, state the assumption briefly and choose the most reversible path. Do not turn every ambiguity into a blocking question.

## Source Note
Distilled from `outputs/core-desire-clarify.md`, which cites vendor guidance and research on clarification, expected information gain, and implicit user-intent recovery.
