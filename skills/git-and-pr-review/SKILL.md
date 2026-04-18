---
name: git-and-pr-review
description: Applies disciplined branching, commit hygiene, and pull request workflows, including stacked PRs when refactors must land before feature work.
---

# Git and PR Review

Use this skill when preparing branches, commits, and pull requests for implementation work.

## Branching
- Create a branch unless already on an appropriate working branch.
- Use conventional prefixes:
  - `feat/`
  - `fix/`
  - `refactor/`

## Commits
Commit coherent units of work.

Commit messages should:
- preserve the **why** of the change
- avoid narrating obvious mechanics already visible in the diff
- be understandable without hidden conversational context

## Pull Requests
- Verify PR state before saying a PR is open.
- If a refactor is needed before a feature, prefer stacked work:
  1. open a refactor branch and PR
  2. branch feature work from the refactor branch
  3. open the feature PR against the refactor branch

## Review Checklist
- Is the branch name appropriate?
- Are commits logically grouped?
- Does the commit message explain why?
- Is the PR target branch correct?
- If stacked, is the dependency chain clear?
