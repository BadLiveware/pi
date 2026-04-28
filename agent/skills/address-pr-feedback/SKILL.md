---
name: address-pr-feedback
description: Use when the user explicitly asks to inspect/address the current branch's open pull request end-to-end, including gathering comments/checks, committing fixes, and pushing. Do not use for pr-upstream-status auto-solve prompts that already provide PR feedback/CI context.
---

# Address PR Feedback

Use this skill when the user asks to check an open PR for comments/review feedback, fix issues, commit fixes, and push the branch.

This is the manual end-to-end PR feedback workflow. Do not use it just because a `pr-upstream-status` auto-solve prompt mentions PR comments or CI. Auto-solve prompts already provide starting feedback/CI context and do not imply PR watching, committing, or pushing.

This skill pushes by default after fixes are committed and validated unless the user says not to push or the task is explicitly inspect-only/preparation-only.

## Outcomes
- current branch's open PR is verified
- review comments, conversation comments, requested changes, and relevant checks are collected after pending checks finish for manual end-to-end PR handling
- actionable feedback is triaged into small batchable fixes and larger/separate fixes
- fixes are implemented, validated, committed, and pushed by default
- final response reports fixed groups, commits, validation, push result, and unresolved items

## Safety Boundaries
- Push after commits and validation unless user opts out, task is inspect-only, validation has unresolved decision-requiring failures, or branch/remote state is ambiguous.
- When handling an auto-solve prompt, follow that prompt instead of this end-to-end workflow: verify/fix the provided feedback, inspect linked details only if needed, run relevant local validation, and summarize. Do not start PR check watchers, poll for pending checks, commit, or push unless the user explicitly asks.
- For manual end-to-end PR handling, do not start coding from partial visible comments while PR checks are still pending. Wait for checks to reach terminal state first, or ask the user whether to proceed with incomplete feedback if waiting becomes unreasonable.
- Do not force-push, reset, rebase, delete branches, merge, close, approve, request reviewers, edit PR metadata, or post/resolve PR comments unless explicitly asked.
- If multiple open PRs match or no open PR is found, stop and ask which PR to use.
- Preserve unrelated local changes; do not overwrite or commit them.

## Discovery Workflow
If the current task came from an auto-solve prompt that already includes PR feedback or CI context, skip this discovery workflow unless the prompt context is incomplete. Fetch only the specific linked details needed to verify or fix the provided items.

1. Read local guidance: `AGENTS.md`, `CLAUDE.md`, `README.md`, build/test files, CI, and relevant docs.
2. Check branch, upstream/remote tracking branch, working tree status, and unrelated uncommitted changes.
3. Identify the open PR for the current branch. Prefer `gh pr view --json number,title,headRefName,baseRefName,url,state,reviewDecision,comments,reviews,statusCheckRollup`, `gh pr view --comments`, or GitHub MCP/API equivalents.
4. Wait for PR checks to reach terminal state before starting fixes so the full feedback set is available. Prefer `gh pr checks --watch --interval 10`; otherwise poll status checks/API until none are queued/pending/in progress/waiting/requested/expected. If checks do not finish after a reasonable wait, ask whether to proceed with currently available feedback or keep waiting.
5. Collect actionable review summaries, inline comments/threads, conversation comments, requested changes, and failing/action-required checks relevant to code, tests, docs, or CI in scope.
6. Record a local checklist grouped by affected area and risk; use task tools for non-trivial feedback sets.

## Triage and Implementation
Classify before editing:
- **Batchable small fixes:** low-risk typo, formatting, naming, comments, small test expectations, minor guards/error text, or multiple tiny same-pass changes.
- **Separate commits:** behavior changes, public API/contracts, schema/migration/data-safety/compatibility changes, useful refactors, substantial tests/validation, unrelated areas, or anything clearer to review/rollback alone.

Implementation rules:
- Auto-solve prompts are an explicit choice to proceed with available feedback. Do not wait for check completion or start check watchers after fixing auto-solve items unless the user asks for that follow-up.
- Do not start coding from visible comments while checks are still pending during manual end-to-end PR handling unless the user explicitly chooses to proceed with partial feedback.
- Understand referenced code and requested change before editing.
- Fix review feedback and directly related validation issues; do not silently expand into unrelated cleanup.
- Add/update tests for behavior, compatibility, failure handling, or public contract changes.
- Run fastest relevant validation after each meaningful fix group.
- Track each item as fixed, intentionally not fixed with reason, needs decision, or blocked by unavailable dependency/service.
- Continue through all unblocked actionable feedback before summarizing.

## Commits
Use `commit` for boundaries and message quality.

Commit small related review fixes together when review-friendly. Commit larger/risky/conceptually separate fixes separately. Stage only the current group, inspect staged diff, preserve why in the message, and avoid vague request-source headers like `fix: address PR review feedback`.

After each commit, check `git status --short` and continue with the next feedback group. Do not amend, squash, rebase, or force-push unless explicitly asked or required by local guidance and confirmed safe.

## Validation and Push
- Prefer project-sanctioned commands from local docs/CI.
- Run focused checks for changed areas plus broader validation before pushing when feasible.
- Treat failed or action-required PR checks as actionable feedback when they map to in-scope code/tests/docs/CI.
- If validation fails, fix within scope and rerun; stop only when failure requires a decision or unavailable dependency.
- Record what passed, failed, was skipped, and remains unverified.

Push by default after all unblocked feedback is addressed or recorded, intended commits exist, validation has passed or gaps are understood, and `git status --short` shows no unintended uncommitted changes.

Use `git push`, or `git push -u origin <current-branch>` if no upstream. Do not use force options without explicit approval.

## Final Response
After pushing, summarize concisely:
- PR number/title or URL checked
- feedback groups fixed and unresolved items
- commits created
- validation commands and results
- push target and result

Do not claim comments are resolved on GitHub unless you actually posted/marked them resolved with explicit permission.
