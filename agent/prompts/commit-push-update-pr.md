---
description: Commit current changes, push the branch, and update the open PR title/body
argument-hint: "[notes]"
---

Commit, push, and update the current PR title/body.

Additional instructions from the invocation:

```text
$ARGUMENTS
```

Treat this prompt as explicit permission to create appropriate commits, push the current branch, and create/update the current branch PR as needed. Do not force-push, rebase, squash, amend, merge, close PRs, request reviewers, or mark/resolve review comments unless explicitly asked.

Workflow:
1. Use the `commit` skill for staging, commit boundaries, message quality, and preserving unrelated local changes.
2. Inspect `git status --short`, the current branch/upstream, and the intended diff. If unrelated or ambiguous changes are present, stage only the in-scope changes and ask before touching the rest.
3. Run validation appropriate to the changed files before committing, or clearly record why validation is unavailable or intentionally skipped.
4. Commit coherent groups. Re-check `git status --short` after each commit.
5. Push to the current upstream, or use `git push -u origin <current-branch>` if no upstream exists. Never use force options unless explicitly asked.
6. Verify the open PR for the current branch with `gh pr view` or equivalent. If no open PR exists, report the push result and explicitly offer to create one.
7. Update the PR title and body/description so they accurately cover what is now in the PR after the pushed commits. Do not treat "update PR" as merely adding a comment.
8. Preserve useful existing PR body structure when it still matches; otherwise rewrite the title/body entirely if the pushed changes alter the PR's semantic meaning, scope, motivation, validation, or user-facing impact.
9. Include the new changes, current validation, and remaining risks/gaps in the PR description. Use a PR comment only if the user explicitly asks for a comment or the host/repository convention clearly requires status updates as comments instead of body edits.
10. Do not start long CI/check watching after pushing unless the user asked for it. If checks are already failed and directly relevant, mention them; otherwise leave post-push CI monitoring to the user/PR system.
11. Final response: commit(s), push target/result, PR URL/title/body update action, validation, and any unresolved items.
