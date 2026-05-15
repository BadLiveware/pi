---
name: prompt-behavior-testing
description: Use when writing, editing, or validating prompts, tool descriptions, command help, subagent/task payloads, policy text, extension skills, or other agent-facing guidance that future agents will follow.
---

# Prompt Behavior Testing

Agent-facing guidance is executable behavior. A prompt, tool description, command help string, skill, policy note, or payload template is not ready until it predictably causes the intended agent behavior under realistic pressure, or the validation gap is explicit.

## Core Rule

Test the behavior the guidance is supposed to induce, not just the prose. Use natural scenarios that could fool an agent, observe what it chooses, tighten the wording when needed, and retest the same scenario until it passes or the next fix would change the intended semantics.

## What Counts as Agent-Facing Guidance

Use this skill for behavior-affecting text in:
- skills and global/project instructions
- extension tool descriptions and parameter descriptions
- slash command help and examples
- prompt builders and system/developer prompt fragments
- subagent, worker, auditor, governor, or handoff payload templates
- read-only policy findings that suggest future actions
- README/how-to snippets that agents are expected to follow

Do not use this for ordinary user-facing docs unless the docs are meant to steer future agents.

## Testing Workflow

1. State the target behavior and the failure mode the guidance must prevent.
2. Identify positive triggers and nearby negative triggers.
3. Choose the cheapest decisive test tier: choice, micro-action, or mini end-to-end.
4. Run a RED/baseline check when practical; if isolation is impossible, record the limitation.
5. Edit the smallest guidance text that should change the behavior.
6. Run the same or paired scenario with the changed guidance.
7. If behavior still fails and the intended semantics are unchanged, add a targeted counter and retest.
8. Stop and ask before changing the guidance’s purpose, authority, safety policy, model/tool assumptions, or speed/cost/quality tradeoff.
9. Record model/agent used, scenario, observed behavior, fix, result, and gaps.

## Scenario Design

Good tests make the agent want to do the wrong thing.

Use natural user language. Do not leak the exact skill name, tool name, section heading, or expected framework term unless recognition of that exact term is the behavior under test.

For trigger-sensitive guidance, test both directions:
- **positive trigger:** natural wording where the guidance should be used
- **negative trigger:** nearby wording where it should not trigger, should defer to another skill/tool, or should remain lightweight/internal

For discipline or safety guidance, add pressure:
- time pressure
- user or authority pressure
- sunk cost
- cost/quota pressure
- embarrassment or social pressure
- long-session fatigue
- tempting hybrid rationalization

A strong choice scenario includes:
1. a concrete repo/path or extension surface
2. specific consequences
3. multiple pressures or distractors
4. explicit options or a forced next action
5. no easy “ask the user” escape unless asking is the desired behavior

## Test Tiers

| Tier | Use when | Passing means |
| --- | --- | --- |
| Choice pressure test | You need fast trigger/compliance evidence | Agent chooses the intended branch under pressure |
| Micro-action test | Guidance depends on inspecting or taking 1-3 realistic actions | Agent uses the intended process within a small tool/action budget |
| Mini end-to-end test | High-risk guidance must survive a small realistic workflow | Agent completes the workflow while preserving the rule |

Prefer micro-action tests after significant behavior changes, pruning, splitting, or extension prompt changes that affect tool use.

## Delegated Prompt Tests

When delegating a choice-pressure or micro-action prompt test, prefer the `prompt-behavior-tester` subagent. It is a no-edit testing role; a correct answer to a forced-choice or verdict-only scenario is success even when no files changed.

Put the literal constraint `Do not edit files.` near the start of delegated prompt-behavior test tasks, especially when the scenario contains implementation-looking words such as “implement”, “fix”, “update”, or “run worker”. This keeps the execution harness aligned with the no-edit contract instead of mistaking the test for an implementation handoff.

Do not use generic `delegate` for prompt-behavior tests with implementation-looking wording unless the task contract explicitly says `Do not edit files.` and output-only/no-tools, and you are prepared to treat no-edit output as advisory evidence. If the exact agent is unavailable, continue directly or use a clearly labeled degraded fallback and record the gap.

## Model Coverage

For behavior-affecting guidance changes, verify with both:
1. the normal/default model used for ordinary work, and
2. the cheapest or smallest supported enabled model that might realistically execute the guidance.

Call `list_pi_models` before choosing the lower-cost model. Use only models with local support and enabled status unless the user explicitly authorizes configuration changes. If no appropriate cheap/mini model is enabled, record the skipped tier and why. Do not use a premium low-latency `-spark` model as a cheap/mini substitute.

For reference-only or non-behavioral edits, one model or structural validation may be enough if you record why broader behavior testing is not relevant.

## Extension Guidance Checks

When testing extension guidance, verify that an agent:
- selects the intended tool/command/skill for natural user wording
- avoids the tool/command/skill for nearby non-trigger wording
- supplies required parameters in the expected structure
- respects read-only vs mutating boundaries
- performs required inspect → mutate → verify loops when the extension is configurable
- does not infer hidden side effects that the extension does not provide
- handles validation gaps, missing credentials, or unavailable runtime state explicitly

For tool descriptions, test both the tool choice and the parameter shape. For prompt builders or payload templates, test whether the recipient returns the requested contract rather than generic advice.

## Common Fixes After Failed Tests

When behavior fails, record the observed action and inferred loophole before editing. Fix the smallest thing that would have blocked that failure:
- move a critical rule earlier
- add an explicit no-exceptions sentence
- add a nearby negative trigger
- name the tempting rationalization and the required response
- clarify read-only vs mutating authority
- add a concrete output contract
- split overloaded guidance into separate skills or prompt sections
- remove wording that over-triggers or anchors the agent

Do not add vague warnings like “be careful.” Add the specific counter that addresses the observed failure.

## Reference

Use `testing-agent-guidance-with-subagents.md` for detailed subagent/external Pi test procedures, hermetic runs, examples, and completion checklist.

## Attribution

Adapted from the writing-skills and skill-testing framework in `pcvelz/superpowers` (MIT). See `SUPERPOWERS-LICENSE.md`.
