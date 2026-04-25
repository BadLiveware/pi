---
name: commit
description: Use when committing changes or deciding commit boundaries. Creates clear, reviewable commits with coherent staging, a brief first line under 72 characters, and a body explaining why for non-trivial changes.
---

# Commit

Use this skill whenever creating commits or deciding commit boundaries. Future readers should understand what changed and why without the chat, PR, or issue thread.

## Safety Boundaries
- Do not commit unless the user explicitly asked for a commit, manually invoked this skill on its own, or the active skill/workflow includes committing.
- Treat standalone/manual invocation of this skill as a request to create the appropriate commit(s), not just explain committing. It is not permission to sweep the whole working tree; first identify which changes are intended for this commit request.
- When commit permission is active for multi-step work, commit at validated semantic checkpoints instead of waiting for one dump commit.
- Do not push unless the user asked or the active workflow explicitly pushes by default.
- Do not force-push, rebase, reset, squash, amend, tag, merge, or run destructive cleanup without explicit approval.
- Preserve unrelated local changes. Unrelated means do not commit it at all, not even in a separate commit. Manual invocation does not expand scope to every changed file; stage only files or hunks that belong to the user-requested/current commit intent.

## Semantic Boundaries
A commit should be one complete semantic piece of work: understandable, reviewable, testable, and revertible as a unit.

Avoid:
- **Dump commits:** unrelated fixes, refactors, docs, generated files, and behavior changes bundled because they happened together.
- **Drive-by commit sets:** separate commits for unrelated local changes that were not part of the user's requested/current commit intent.
- **Line-item commits:** tiny commits for individual lines, typo-by-typo edits, or fragments that are not independently meaningful.

Before staging, group by intent and ask: "Would this still make sense if reviewed, reverted, or cherry-picked alone?"

Batch together small related fixes with one motivation. Keep source, tests, docs, migrations, and generated artifacts together when they are required for the same behavior to be complete. Split behavior changes, public contracts, migrations, data-safety changes, useful preparatory refactors, standalone test/docs work, unrelated areas, or anything clearer to review/rollback separately.

If in doubt, prefer the smallest semantic commit that is complete on its own, not the smallest textual diff. Example: if a parser fix plus tests are intended and an unrelated docs typo is also present, commit only the parser fix/tests and leave the docs typo unstaged unless the user explicitly asked to include it.

## Commit Context and Message
Before writing the message, inspect the intended diff and identify:
- the overall goal of the commit group
- the problem solved and why this approach exists
- relevant constraints, trade-offs, compatibility notes, or operational concerns
- validation evidence or explicit validation gaps when useful

Do not summarize by request source unless the source itself matters. Prefer `fix: keep sweep artifacts stable` over `fix: address PR feedback`.

Default structure:

```text
<type>: <brief summary under 72 chars>

<body explaining what changed and why>
```

Header rules:
- under 72 characters
- summarize the actual change
- follow project style; conventional prefixes are preferred when they fit: `fix:`, `feat:`, `test:`, `docs:`, `refactor:`, `chore:`

Body rules:
- include a brief body for every non-trivial commit
- explain motivation and important behavior changes without restating the diff mechanically
- preserve important constraints, trade-offs, compatibility decisions, or validation context
- optional only for truly trivial commits where the header fully explains the change

## Workflow
1. Check `git status --short` and identify unrelated local changes.
2. Inspect the intended diff before staging.
3. Partition the intended diff into semantic commit groups; leave unrelated changes unstaged unless the user explicitly asked to include them.
4. Stage only the current group.
5. Re-check `git diff --cached`; if it reads like a dump or fragment, adjust staging.
6. Validate the staged change or record the validation gap if committing is still appropriate.
7. Commit with the message structure above.
8. Check `git status --short` and continue with the next semantic group when commit permission remains active.

## Examples
For examples and regression cases when editing this skill, see `examples.md`.
