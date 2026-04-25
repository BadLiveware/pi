---
name: commit
description: Use when committing changes or deciding commit boundaries. Creates clear, reviewable commits with coherent staging, a brief first line under 72 characters, and a body explaining why for non-trivial changes.
---

# Commit

Use this skill whenever creating commits or deciding commit boundaries. The goal is for future readers to understand what changed and why without needing the chat, PR review, or issue thread.

## Safety Boundaries
- Do not commit unless the user explicitly asked for a commit or the active skill/workflow explicitly includes committing.
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

If in doubt, prefer a separate commit over a mixed commit.

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
3. Stage only the files for the current coherent commit group.
4. Re-check the staged diff with `git diff --cached`.
5. Write the commit message using the structure above.
6. Commit.
7. Check `git status --short` after committing and continue with the next commit group if needed.
