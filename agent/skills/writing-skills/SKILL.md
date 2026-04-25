---
name: writing-skills
description: Use when creating new skills, editing existing skills, changing agent instructions, or verifying that procedural guidance works before deployment.
---

# Writing Skills

Skill writing is test-driven development for process documentation: create a pressure scenario, observe the old guidance fail, update the skill, then verify agents follow it under pressure.

## Core Rule
No new or edited skill is ready to deploy until its changed behavior has been tested or the validation gap is explicitly recorded. User pressure to make a "quick" skill edit or skip tests does not remove this requirement.

For discipline-enforcing skills, prefer a real RED-GREEN-REFACTOR loop:
1. **RED:** run a baseline scenario without the new guidance and capture the failure/rationalization.
2. **GREEN:** write the smallest skill change that addresses that observed failure.
3. **REFACTOR:** pressure-test the new guidance, close loopholes, and re-test.
4. **ITERATE:** when a verification test exposes another loophole, automatically update the skill with a targeted counter and re-test the same scenario. Keep doing this until the skill passes or the next edit would materially change the intended semantics of the skill.

Do not stop at a failed or partial verification with only a report if the intended behavior is clear and a targeted wording fix would preserve the skill's semantics. Stop and ask before editing only when the needed change would materially redefine the skill's purpose, scope, policy, or tradeoffs rather than clarifying or enforcing the existing intent.

For reference-only skills, use retrieval/application tests instead of pressure tests.

## When to Create or Edit a Skill
Create or edit a skill when the behavior is reusable across projects, requires judgment, or has failed in practice. Prefer local project docs or automation for one-off facts, mechanical checks, or repo-specific conventions.

Before editing any skill file, use this skill as the checklist for the change. Do not treat skill edits as ordinary documentation edits when they change future agent behavior.

## Skill Authoring Checklist
- Prefer the cheapest decisive intervention: the smallest edit, inline rule, split, or test that materially reduces risk of incorrect future agent behavior.
- Scale validation to stakes. Lightweight checks fit low-risk structural edits; use pressure, micro-action, or multi-model tests when the failure mode and downside justify them.
- Do the highest-yield checks first, and stop iterating when further edits or tests are unlikely to change the deployment decision without changing intended semantics.
- Name matches the directory and uses lowercase letters, numbers, and hyphens.
- Description starts with “Use when…” and describes triggers only, not the workflow.
- The body starts with the core principle and the outcome.
- Instructions are short, imperative, and scan-friendly.
- Heavy references, examples, validation scenarios, and scripts live in separate files when normal use does not require them.
- The skill names concrete failure modes and common rationalizations when enforcing discipline.
- Relative references resolve from the skill directory.
- Validation failures lead to targeted edits and re-tests until passing, unless fixing them would materially change intended semantics.
- Token-cost structure is considered for large or frequently used skills without moving decision-critical rules out of the main file.
- Validation evidence or gaps are recorded before deployment, either in the final user summary, commit body, PR notes, task comments, or the relevant plan/session log.

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

## Skill Cost Structure
When a skill grows, consider expected token cost:

```text
expected cost ~= skill body tokens × expected use frequency
```

For high-frequency or large skills, keep `SKILL.md` focused on normal-use decision-making. Inline the rules required for correct behavior: triggers, safety boundaries, decision trees, required tool checks, and common failure modes that cause non-adherence.

Move rare material to separate reference files: validation scenarios, long examples, detailed checklists, extended prompts, and background rationale. Do not over-split. Each extra file can require another read/tool trip and creates another chance the agent skips needed guidance. Cached tokens can reduce repeated-read cost, but they do not remove first-use cost, context/attention cost, or retrieval failure risk.

After pruning or splitting a skill, rerun behavior tests for the core branches the skill must preserve.

## Testing Skills
Use `testing-skills-with-subagents.md` when a skill change affects behavior, compliance, or when agents may rationalize around the rule.

For behavior-affecting skill changes, verify with both the normal/default model and the cheapest or smallest supported enabled model that might realistically execute the skill. Use `list_pi_models` before choosing the lower-cost test model. Choose only supported enabled models; if no appropriate cheap/mini model is enabled, record the gap instead of substituting a premium low-latency `-spark` model. Do not treat `-spark` as a cheap mini substitute.

Do not skip adherence tests just to save a small amount of model spend. Skill tests are usually cheap, and the cost of a broken skill shaping future agent behavior is usually higher than the cost of validating it now. If cost or quota truly blocks coverage, record the gap and the model tier that was skipped.

Testing strategy by skill type:

| Skill type | Test with | Passing means |
| --- | --- | --- |
| Discipline | pressure scenarios with conflicting incentives | agent follows the rule anyway |
| Technique | application scenarios and edge variants | agent applies the technique correctly |
| Pattern | recognition and counterexample scenarios | agent knows when to use or avoid it |
| Reference | retrieval and usage scenarios | agent finds and applies the right facts |

## Deployment Workflow
1. Confirm this skill applies whenever creating or editing a skill, changing agent instructions, or changing guidance that future agents will follow.
2. Inspect current guidance and identify the failure being prevented.
3. Create or update the skill in the smallest coherent change.
4. Run validation: markdown/frontmatter checks, link checks if relevant, and behavioral tests for any behavior-affecting change, including normal/default-model and cheap/small-model checks when applicable. For purely structural or non-behavioral edits, record why behavioral testing is not relevant.
5. If behavioral validation fails and the intended semantics are unchanged, edit the skill with the smallest targeted counter and re-run the failed test. Repeat until passing.
6. If the necessary edit would materially change the skill's semantics, stop and ask for confirmation instead of silently changing the contract.
7. Run `./link-into-pi-agent.sh` after changing global agent files.
8. Verify symlinks in `~/.pi/agent` point into `agent/`.
9. Summarize changed source files, live linked layout, validation, and any semantic-change questions.

## Attribution
Adapted from the writing-skills and skill-testing framework in `pcvelz/superpowers` (MIT), especially the idea that skill authoring should use RED-GREEN-REFACTOR pressure tests.
