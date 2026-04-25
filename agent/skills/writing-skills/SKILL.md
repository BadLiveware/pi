---
name: writing-skills
description: Use when creating new skills, editing existing skills, changing agent instructions, or verifying that procedural guidance works before deployment.
---

# Writing Skills

Skill writing is test-driven development for process documentation: create a pressure scenario, observe the old guidance fail, update the skill, then verify agents follow it under pressure.

## Core Rule
No new or edited skill is ready to deploy until its changed behavior has been tested or the validation gap is explicitly recorded.

For discipline-enforcing skills, prefer a real RED-GREEN-REFACTOR loop:
1. **RED:** run a baseline scenario without the new guidance and capture the failure/rationalization.
2. **GREEN:** write the smallest skill change that addresses that observed failure.
3. **REFACTOR:** pressure-test the new guidance, close loopholes, and re-test.
4. **ITERATE:** when a verification test exposes another loophole, automatically update the skill with a targeted counter and re-test the same scenario. Keep doing this until the skill passes or the next edit would materially change the intended semantics of the skill.

Do not stop at a failed or partial verification with only a report if the intended behavior is clear and a targeted wording fix would preserve the skill's semantics. Stop and ask before editing only when the needed change would materially redefine the skill's purpose, scope, policy, or tradeoffs rather than clarifying or enforcing the existing intent.

For reference-only skills, use retrieval/application tests instead of pressure tests.

## When to Create or Edit a Skill
Create or edit a skill when the behavior is reusable across projects, requires judgment, or has failed in practice. Prefer local project docs or automation for one-off facts, mechanical checks, or repo-specific conventions.

## Skill Authoring Checklist
- Name matches the directory and uses lowercase letters, numbers, and hyphens.
- Description starts with “Use when…” and describes triggers only, not the workflow.
- The body starts with the core principle and the outcome.
- Instructions are short, imperative, and scan-friendly.
- Heavy references, examples, and scripts live in separate files.
- The skill names concrete failure modes and common rationalizations when enforcing discipline.
- Relative references resolve from the skill directory.
- Validation failures lead to targeted edits and re-tests until passing, unless fixing them would materially change intended semantics.
- Validation evidence or gaps are recorded before deployment.

## Description Guidance
Descriptions are selection triggers. Do not summarize the process, because agents may follow the description without loading the body.

Good:
```yaml
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently
```

Bad:
```yaml
description: Use for flaky tests by adding retries, polling loops, and teardown checks
```

## Testing Skills
Use `testing-skills-with-subagents.md` when a skill change affects behavior, compliance, or when agents may rationalize around the rule.

Testing strategy by skill type:

| Skill type | Test with | Passing means |
| --- | --- | --- |
| Discipline | pressure scenarios with conflicting incentives | agent follows the rule anyway |
| Technique | application scenarios and edge variants | agent applies the technique correctly |
| Pattern | recognition and counterexample scenarios | agent knows when to use or avoid it |
| Reference | retrieval and usage scenarios | agent finds and applies the right facts |

## Deployment Workflow
1. Inspect current guidance and identify the failure being prevented.
2. Create or update the skill in the smallest coherent change.
3. Run validation: markdown/frontmatter checks, link checks if relevant, and behavioral tests for non-trivial rules.
4. If behavioral validation fails and the intended semantics are unchanged, edit the skill with the smallest targeted counter and re-run the failed test. Repeat until passing.
5. If the necessary edit would materially change the skill's semantics, stop and ask for confirmation instead of silently changing the contract.
6. Run `./link-into-pi-agent.sh` after changing global agent files.
7. Verify symlinks in `~/.pi/agent` point into `agent/`.
8. Summarize changed source files, live linked layout, validation, and any semantic-change questions.

## Attribution
Adapted from the writing-skills and skill-testing framework in `pcvelz/superpowers` (MIT), especially the idea that skill authoring should use RED-GREEN-REFACTOR pressure tests.
