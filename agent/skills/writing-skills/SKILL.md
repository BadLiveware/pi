---
name: writing-skills
description: Use when creating, editing, splitting, renaming, or validating Pi skills and their trigger descriptions.
---

# Writing Skills

Skills are trigger-gated operational guidance. A good skill is selected at the right time, stays out of the way otherwise, and gives future agents the smallest reliable procedure they need.

## Core Rule

Treat skill edits as behavior changes unless they are purely mechanical. Before deploying a new, edited, split, or renamed skill, verify the structure and either test the changed behavior with `prompt-behavior-testing` or record why behavioral validation is not relevant.

Use this skill for skill shape and packaging. Use `../prompt-behavior-testing/SKILL.md` when validating prompts, tool descriptions, command help, subagent payloads, policy text, or behavior-affecting skill guidance.

## When to Create or Edit a Skill

Create or edit a skill when the behavior is reusable across projects, requires judgment, or has failed in practice. Prefer local project docs or automation for one-off facts, mechanical checks, generated outputs, or repo-specific conventions.

Before editing any skill file, identify:
- the future behavior the skill should trigger
- the nearby situations where it should not trigger
- whether the change affects behavior, retrieval, structure, or only wording
- what validation evidence or explicit gap will be recorded

## Skill Authoring Checklist

- Name the directory and `name` field with lowercase letters, numbers, and hyphens.
- Keep the `description` as trigger text only: start with “Use when…” and do not summarize the workflow.
- Make the first body section state the core principle and expected outcome.
- Keep normal-use instructions short, imperative, and scan-friendly.
- Put decision-critical triggers, safety boundaries, and common rationalizations in `SKILL.md`; do not hide them in a reference file.
- Move rare examples, long scenarios, background rationale, and validation transcripts into separate files.
- Resolve relative references from the skill directory.
- Prefer the smallest coherent edit, split, or new skill that materially reduces future-agent error.
- When splitting, keep normal-use decisions in the main skill and rerun behavior tests for the branches the split must preserve.
- Record routine validation evidence or gaps in the final summary, PR notes, task comments, or relevant plan/session log; use the commit body only for noteworthy validation context or gaps that affect review or trust.

## Description Guidance

Descriptions are selection triggers. Agents may follow the description without loading the body, so descriptions must say when to use the skill, not how to perform the workflow.

Good:
```yaml
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently.
```

Bad:
```yaml
description: Use for flaky tests by adding retries, polling loops, and teardown checks.
```

For split skills, make the boundary explicit:
- skill-writing trigger: creating/editing/splitting/renaming skills
- prompt-behavior trigger: validating prompts/tool descriptions/agent-facing guidance that future agents will follow

## Cost and File Structure

Consider expected token cost:

```text
expected cost ~= skill body tokens × expected use frequency
```

For frequent skills, keep `SKILL.md` focused on normal-use decision-making. Do not over-split: each extra file adds a read/tool trip and creates another chance the agent skips needed guidance. Cached tokens can reduce repeated-read cost, but they do not remove first-use cost, context cost, or retrieval failure risk.

A good split moves rare material out while preserving the rules needed for correct first-pass behavior.

## Validation

Structural checks for skill changes:
- frontmatter has `name` and trigger-only `description`
- directory name matches `name`
- referenced files exist and relative paths resolve from the skill directory
- no stale references to moved or renamed skills/files
- linked live layout is refreshed with `./link-into-pi-agent.sh` for files under `agent/`

Behavior checks:
- If a skill change affects future-agent behavior, use `prompt-behavior-testing`.
- Test positive and negative trigger boundaries for trigger-sensitive changes.
- Pressure-test discipline or safety rules when agents may rationalize around them.
- If validation fails and the intended semantics are unchanged, make the smallest targeted fix and rerun the failed scenario.
- Stop and ask when the needed fix would materially change the skill’s purpose, scope, authority, safety policy, model/tool assumptions, or tradeoffs.

## Deployment Workflow

1. Confirm the change belongs in a skill rather than local docs, config, or automation.
2. Inspect current skill guidance and identify the behavior or retrieval problem being addressed.
3. Make the smallest coherent skill addition, edit, split, rename, or deletion.
4. Run structural validation.
5. For behavior-affecting changes, run `prompt-behavior-testing` or record the validation gap.
6. Run `./link-into-pi-agent.sh` after changing global agent files.
7. Verify `~/.pi/agent` symlinks point into `agent/`.
8. Summarize source changes, live linked layout, validation, and any semantic-change questions.

## Attribution

Adapted from the writing-skills and skill-testing framework in `pcvelz/superpowers` (MIT). See `SUPERPOWERS-LICENSE.md`.
