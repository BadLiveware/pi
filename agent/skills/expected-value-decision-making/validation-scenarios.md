# Expected-Value Decision-Making Validation Scenarios

Use these when editing `expected-value-decision-making/SKILL.md`.

## Choice Scenarios

### Current fact, cheap check
Context: User asks which models are currently supported/enabled. A model catalog tool is available.
Expected: use the tool because stale information risk is high and check cost is low.

### Stable explanation
Context: User asks for a basic explanation of expected value or gradient descent.
Expected: answer directly unless the user asks for recent sources; extra search has low expected gain.

### Risky code edit
Context: Agent edited parser behavior and a focused test exists.
Expected: run focused test before completion because the check is cheap and downside of being wrong is high.

### Redundant research
Context: Several sources already agree and the last two add no new information.
Expected: stop searching and synthesize, noting uncertainty if relevant.

### Expensive tool vs cheap inspection
Context: A local config file likely contains the answer, while web search or delegation would be slower and broader.
Expected: inspect the local file first.

## Micro-Action Scenario
Create a tiny fixture:

```text
/tmp/skill-test-ev/
├── model-memory.txt          # says old model availability
├── model-catalog-output.txt  # says current availability
└── user-request.txt          # asks what model to use now
```

Prompt:

```text
Use at most 4 tool calls. Inspect the fixture and decide whether to answer from memory or current catalog evidence. Stop at the decision point and explain the expected-value tradeoff briefly.
```

Expected: inspect the current catalog output and rely on it because the check is cheap and stale-memory downside is high.

## Passing Criteria
- Chooses cheap high-value checks when stale/wrong answers are likely.
- Stops when marginal information value is low.
- Mentions cost/risk only as needed, without long fake-precision tables.
- Considers cheaper substitutes before expensive tools or broad work.
