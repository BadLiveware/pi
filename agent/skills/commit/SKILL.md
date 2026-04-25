---
name: commit
description: Use when committing changes or deciding commit boundaries. Creates clear, reviewable commits with coherent staging, a brief first line under 72 characters, and a body explaining why for non-trivial changes.
---

# Commit

Use this skill whenever creating commits or deciding commit boundaries. The goal is for future readers to understand what changed and why without needing the chat, PR review, or issue thread.

## Safety Boundaries
- Do not commit unless the user explicitly asked for a commit, manually invoked this skill on its own, or the active skill/workflow explicitly includes committing.
- Treat a standalone/manual invocation of this skill as a request to actually create the appropriate commit(s), not merely to explain how committing would work.
- When commit permission is active for multi-step work, commit at validated semantic checkpoints instead of waiting for one final dump commit.
- Do not push unless the user explicitly asked for a push or the active skill/workflow explicitly pushes by default.
- Do not force-push, rebase, reset, squash, amend, tag, or merge without explicit approval.
- Preserve unrelated local changes. Stage only files that belong in the current commit.

## Commit Context
Before writing a commit message, gather enough context to explain the change:
- inspect the staged diff and any unstaged changes intended for this commit
- identify the overall goal of the commit group, not just the final tweak
- identify what problem the change solves
- identify why this approach was chosen when that is not obvious
- preserve relevant constraints, trade-offs, compatibility notes, or operational concerns
- include validation evidence when it materially helps future readers
- if the reason is not clear, ask: "What's the overall goal of these changes? Anything worth capturing for future readers?"

Do not summarize the commit by the source of the request unless the source is itself relevant to the project history. For example, avoid messages like `fix: address PR review feedback`; explain what actually changed and why.

## Commit Boundaries
Prefer commits that are coherent, reviewable, and revertible.

A commit should be one complete semantic piece of work: a change that future readers can understand, review, test, and revert as a unit. Avoid both extremes:
- **Dump commits:** unrelated fixes, refactors, docs, generated files, and behavior changes bundled only because they happened in the same session.
- **Line-item commits:** tiny commits for individual lines, typo-by-typo edits, or mechanical fragments that are not independently meaningful.

Before staging, group the diff by intent. Ask: "Would this commit still make sense if reviewed, reverted, or cherry-picked alone?" If not, split it differently or batch related fragments together.

Batch together:
- small related fixes in the same area
- typo, comment, naming, formatting, and straightforward test updates
- tiny changes that share one motivation and would be noisy as separate commits

Separate commits for:
- behavior changes
- public API, schema, data-safety, migration, or compatibility changes
- refactors that are useful to review independently
- test-only changes that establish or protect behavior independently
- docs/migration work that should stand on its own
- unrelated areas of the codebase
- any change where review or rollback is clearer as its own commit

Do not split a semantic unit just because it touches multiple files. Tests, docs, migrations, generated artifacts, and source changes belong together when they are required for the same behavior to be complete and reviewable. Do split preparatory refactors from behavior changes when each can stand alone.

If in doubt, prefer the smallest semantic commit that is complete on its own, not the smallest textual diff.

## Checkpoint Commit Policy
When commit permission is active, commit continuously at semantic checkpoints:
- after a complete, validated behavior change
- after an independently useful refactor
- after a docs, config, migration, or test-only change that stands alone
- after a plan slice or long-plan increment that leaves the repository coherent

Do not commit incomplete scaffolding, unvalidated changes, unresolved merge/conflict states, unrelated changes bundled together, or fragments that only make sense as part of a later commit. If validation for a checkpoint is unavailable but committing is still useful, record the validation gap in the commit body.

## Message Structure
Use this structure by default:

```text
<type>: <brief summary under 72 chars>

<body explaining what changed and why>
```

Header rules:
- first line under 72 characters
- summarize the actual change, not the request source
- use the project's established style; conventional prefixes are preferred when they fit: `fix:`, `feat:`, `test:`, `docs:`, `refactor:`, `chore:`
- be specific enough to distinguish the commit in `git log`

Body rules:
- include a body for every non-trivial commit
- keep it brief: usually 1-3 short paragraphs or bullets
- explain the motivation and why the change exists
- summarize important behavior/code changes without restating the diff mechanically
- preserve constraints, trade-offs, compatibility decisions, or operational notes when relevant
- mention validation only when it adds useful context
- do not let the last minor fix dominate the body when the commit contains broader work

A body is optional for truly trivial commits where the header fully explains the change, such as a typo fix.

## Examples
Avoid:

```text
fix: address PR review feedback
```

Prefer:

```text
fix: keep sweep artifacts stable across reruns

Preserve named artifact directories unless overwrite is explicitly requested so
benchmark sweeps do not silently replace prior results. This keeps repeated
calibration runs reviewable and makes failed reruns easier to diagnose.
```

Avoid:

```text
test: update expectations from review
```

Prefer:

```text
test: cover dense benchmark matrix rendering

Add coverage for dense processing rows so latency-band classification and mode
columns stay stable while the sweep report schema evolves.
```

## Workflow
1. Check `git status --short` and identify unrelated local changes.
2. Inspect the intended diff before staging or committing.
3. Partition the diff into semantic commit groups: each group should have one intent, be complete enough to validate/revert alone, and avoid unrelated changes.
4. Stage only the files or hunks for the current coherent commit group.
5. Re-check the staged diff with `git diff --cached`; if it reads like a dump commit or a line-item fragment, adjust staging before committing.
6. Write the commit message using the structure above.
7. Commit.
8. Check `git status --short` after committing and continue with the next semantic group if needed. For multi-step work with commit permission, repeat this workflow after each validated semantic checkpoint.
