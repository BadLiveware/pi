---
name: address-pr-feedback
description: Inspect the current branch's open pull request, gather review comments and checks, fix the requested issues, commit fixes with small issues batched and larger issues separated, validate, and push by default unless the user says not to push.
---

# Address PR Feedback

Use this skill when the user asks to check an open pull request for comments/review feedback, fix the issues, commit the fixes, and push the branch.

This skill pushes by default after fixes are committed and validated unless the user says not to push or the task is explicitly inspect-only/preparation-only.

## Reach for This Skill When
- the current branch has an open PR that needs review comments addressed
- the user asks to fix PR comments, review feedback, requested changes, or failing PR checks
- the user asks to commit and push, or does not opt out of the skill's default push behavior
- commit grouping matters for reviewer clarity

## Outcomes
- the open PR for the current branch is verified
- PR review comments, PR conversation comments, requested changes, and relevant checks are collected after pending checks finish
- feedback is triaged into small batchable fixes and larger/riskier fixes
- fixes are implemented with project-appropriate validation
- small related issues are batched into one coherent commit
- larger, risky, or conceptually separate issues are committed separately
- the branch is pushed after validation unless the user opted out or the task is inspect-only/preparation-only
- final response reports what was fixed, commits created, validation, push result, and anything left unresolved

## Safety Boundaries
- Push is the default outcome for this skill after commits and validation. Do not push only when the user says not to push, the task is explicitly inspect-only/preparation-only, validation has unresolved failures that need a decision, or branch/remote state is ambiguous.
- Do not force-push unless the user explicitly asked for force-push or the repository workflow requires it and you have confirmed it is safe.
- Do not merge, close, approve, request reviewers, edit PR metadata, or post PR comments unless the user explicitly asked for those actions.
- Do not run destructive cleanup such as resetting, rebasing, or deleting branches without explicit approval.
- If multiple open PRs match the current branch, or no open PR is found, stop and ask which PR to use.
- If the working tree has unrelated local changes, preserve them. Do not overwrite or commit unrelated work.

## Discovery Workflow
1. Read local guidance first: `AGENTS.md`, `CLAUDE.md`, `README.md`, build/test files, CI, and relevant docs.
2. Check repository state:
   - current branch
   - upstream/remote tracking branch
   - working tree status
   - existing uncommitted changes
3. Identify the open PR for the current branch. Prefer project tools when available:
   - `gh pr view --json number,title,headRefName,baseRefName,url,state,reviewDecision,comments,reviews,statusCheckRollup`
   - `gh pr view --comments`
   - GitHub MCP/API equivalents when `gh` is unavailable
4. Before starting fixes, wait for PR checks to reach a terminal state so the full feedback set is available:
   - Prefer `gh pr checks --watch --interval 10` when available.
   - Otherwise poll `gh pr view --json statusCheckRollup` or the GitHub API/MCP equivalent until no checks are queued, pending, in progress, waiting, requested, or expected.
   - Treat success, failure, error, cancelled, skipped, timed out, neutral, and action-required as terminal states.
   - If checks do not finish after a reasonable wait, stop and ask whether to proceed with currently available feedback or keep waiting.
5. Collect all actionable feedback:
   - review summaries and requested changes
   - inline review comments and unresolved threads
   - PR conversation comments
   - failing or action-required checks relevant to code changes
   - skipped/cancelled checks only when they indicate a code or workflow issue to fix
6. Record a local checklist of feedback items, grouped by affected area and risk. Use task tools for non-trivial sets of comments.

## Triage Rules
Classify feedback before editing:

### Batchable small fixes
Batch small fixes into one commit when they are low-risk and review-friendly, such as:
- typo, formatting, naming, or comment clarification fixes
- small test expectation updates
- minor guard clauses or straightforward error-message adjustments
- multiple tiny changes requested by the same review pass that do not need separate review reasoning

### Separate commits
Use separate commits for larger or conceptually distinct work, such as:
- behavior changes
- public API or contract changes
- schema, migration, compatibility, or data-safety changes
- refactors that are useful to review independently
- fixes that require substantial tests or validation
- changes in unrelated areas of the codebase
- any fix where rollback or review would be clearer as its own commit

If in doubt, prefer a separate commit over a mixed commit.

## Implementation Workflow
1. For each feedback group, inspect the referenced code and understand the requested change before editing.
2. Preserve scope: fix review feedback and directly related validation issues; do not silently expand into unrelated cleanup.
3. Add or update tests when behavior, compatibility, failure handling, or public contracts change.
4. Run the fastest relevant validation after each meaningful fix group.
5. Keep review feedback status locally tracked:
   - fixed
   - intentionally not fixed with reason
   - needs user/reviewer decision
   - blocked by failing dependency or unavailable credentials/service
6. Continue through all unblocked actionable feedback before summarizing.

## Commit Workflow
Follow the `commit` skill for commit boundaries and message quality.

1. Inspect the diff before each commit and ensure only intended files are included.
2. Stage only the files for the current commit group.
3. Before writing the commit message, gather the commit context and preserve it in the final commit message:
   - what changed in the staged diff
   - the underlying product/technical reason for the change
   - the overall goal of this commit group, not just the last small tweak
   - relevant constraints, trade-offs, compatibility concerns, or reviewer decisions
   - validation that supports the change
   - prior conversation, plan notes, PR comments, and code context needed to preserve the why
4. Write commit messages about the change itself, not the source of the request. Do not use vague review-source messages such as:
   - `fix: address PR review feedback`
   - `fix: address review comments`
   - `fix: address PR review nits`
   - `test: update expectations from PR feedback`
5. Use a brief header as the first line:
   - under 72 characters
   - imperative or concise descriptive mood
   - preferably conventional-prefix style when it fits: `fix:`, `test:`, `docs:`, `refactor:`, `chore:`
   - summarize the actual change, for example `fix: preserve seed reuse across benchmark resets`
6. Add a body for every non-trivial commit. The body should be short but explain why the change exists:
   - one blank line after the header
   - 1-3 concise paragraphs or bullets
   - summarize the important behavior/code changes
   - explain the motivation and why this approach is useful
   - preserve important constraints, trade-offs, or compatibility decisions
   - mention validation when it materially helps future readers
   - do not let the final minor fix dominate the message when the commit contains broader work
7. Batchable small fixes may share one commit, but the header and body still describe the actual grouped changes rather than saying they came from review. Example:

   ```text
   fix: tighten sweep artifact handling

   Keep dry-run output, artifact naming, and overwrite checks aligned so sweep
   runs remain predictable across repeated benchmark executions. This also
   clarifies the validation path for generated matrix artifacts.
   ```

8. Commit larger fixes separately with messages that explain the review-relevant why, for example:

   ```text
   fix: preserve empty-series handling in native query path

   Keep native execution aligned with Prometheus semantics when a selector
   matches no series. Returning an explicit empty result avoids treating missing
   data as a transport failure and keeps fallback decisions deterministic.
   ```

9. If the reason for the staged changes is not clear from the PR, review comments, code, or conversation, ask the user: "What's the overall goal of these changes? Anything worth capturing for future readers?"
10. After each commit, check `git status --short` and continue with the next feedback group.
11. Do not amend, squash, or rebase existing commits unless the user explicitly asked or local project guidance requires it.

## Validation Workflow
- Prefer project-sanctioned commands from local docs/CI.
- Run focused tests for each changed area plus broader validation before pushing when feasible.
- Because checks were waited on before fixing, include any failed or action-required check as an actionable feedback item when it maps to code, tests, docs, or CI configuration in scope.
- If PR checks were failing, reproduce or run the closest local equivalent when possible.
- Record exactly what passed, failed, was skipped, and what remains unverified.
- If validation fails, fix within scope and rerun. Stop for user input only when the failure requires a decision or unavailable dependency.

## Push Workflow
Push by default after:
- all unblocked actionable feedback is addressed or explicitly recorded as unresolved
- intended commits are created
- validation has passed, or gaps are clearly understood and acceptable to report
- `git status --short` shows no unintended uncommitted changes

Push with the safest normal command for the current branch, usually:

```bash
git push
```

If the branch has no upstream, use:

```bash
git push -u origin <current-branch>
```

Do not use `--force` or `--force-with-lease` without explicit approval.

## Final Response
After pushing, summarize concisely:
- PR number/title or URL checked
- review feedback groups fixed
- commits created
- validation commands and results
- push target and result
- unresolved comments, skipped checks, or follow-up decisions needed

Do not claim comments are resolved on GitHub unless you actually posted/marked them resolved with explicit permission.
