---
name: cleanup-commits
description: User-invoked workflow for organizing all current uncommitted repository changes into logical commits. Use only when manually invoked.
disable-model-invocation: true
---

# Cleanup Commits

Use this skill only when the user manually invokes it. Its purpose is to turn the current uncommitted working tree into coherent, reviewable commits.

## Safety Boundaries
- Manual invocation scopes commit-by-default behavior to safe intended current uncommitted work, but does not grant push permission.
- Do not push, force-push, rebase, reset, squash, amend, tag, merge, delete files, or discard changes unless explicitly asked.
- Inspect all tracked and untracked changes before staging anything.
- Do not commit secrets, credentials, local machine config, editor files, build/cache junk, or accidental large/generated artifacts unless clearly intended.
- If a change is suspicious, destructive, unrelated to the repository, or unsafe to preserve in history, stop and ask before committing it.
- Preserve the user's work. If a change should not be committed, leave it uncommitted and report why.

## Commit Boundaries
Group changes by semantic intent, not by file count or by when they happened.

A cleanup commit should be one complete unit that can be understood, reviewed, tested, and reverted alone. Split:
- unrelated features, fixes, docs, refactors, config, migrations, generated artifacts, or test-only work
- behavior changes from preparatory refactors when each stands alone
- risky/public-contract/data-safety changes from low-risk cleanup

Batch:
- tiny related fixes with the same motivation
- source, tests, docs, migrations, and generated artifacts required for one behavior
- small formatting/comment/naming fixes in the same area when separate commits would be noisy

If a file contains changes for multiple intents, stage hunks carefully or ask before making risky manual splits.

## Validation
Match validation to each commit group:
- run focused tests/checks for behavior, contract, migration, or failure-handling changes
- use diff inspection for docs, comments, formatting, or trivial changes when tests add little value
- run broader project checks when several groups interact or risk is high
- if validation is unavailable or too expensive, record the gap in the commit body

Do not claim the cleanup is complete until `git status --short` is clean or remaining uncommitted changes are intentionally left with reasons.

## Workflow
1. Run `git status --short` and inspect all tracked/untracked files.
2. Inspect diffs with `git diff`, `git diff --stat`, `git diff --check`, and file reads as needed. For untracked files, inspect contents before staging.
3. Identify semantic commit groups and list any files that should remain uncommitted.
4. For each group:
   - stage only that group's files or hunks
   - review `git diff --cached`
   - validate at the right depth or record the validation gap
   - commit with a clear message following the `commit` skill's message rules
   - re-check `git status --short`
5. Continue until all safe intended changes are committed.
6. Final response: list commits created, validation run, changes intentionally left uncommitted, and note that no push was performed.

## Commit Message Rules
Use the project style. Prefer conventional prefixes when they fit: `fix:`, `feat:`, `test:`, `docs:`, `refactor:`, `chore:`.

For non-trivial commits, include a short body explaining:
- what changed and why
- important constraints, compatibility notes, or tradeoffs
- validation run or validation gaps when useful

Avoid source-only messages like `cleanup changes`, `address feedback`, or `misc fixes`.
