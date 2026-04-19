---
name: git-and-pr-review
description: Use when branch structure, commit boundaries, commit messages, stacked PRs, target branches, or pull request state need review.
---

# Git and PR Review

Use this skill to structure branches, commits, and pull requests for review.

## Reach for This Skill When
- commit boundaries or commit messages are unclear
- refactors should be separated from behavior changes
- stacked PRs, target branches, or PR state need attention

## Outcome
- a branch and review structure that keeps refactors, behavior changes, and pull request state understandable

## Safety Boundaries
- Do not commit, push, create tags, or open pull requests unless the user explicitly asked for that.
- Do not claim a PR is open or merged without checking its state.

## Branching
- Create a branch unless already on an appropriate one.
- Use conventional prefixes:
  - `feat/`
  - `fix/`
  - `refactor/`

## Commits
- Commit coherent units of work.
- Preserve the **why** in the message.
- Do not narrate mechanics that are already obvious from the diff unless they are subtle.

## Pull Requests
- Verify PR state before describing it.
- If a refactor is needed before a feature, prefer stacked work:
  1. open a refactor branch and PR
  2. branch feature work from the refactor branch
  3. open the feature PR against the refactor branch

## Review Checklist
- Is the branch name appropriate?
- Are commits logically grouped?
- Does the commit message explain why?
- Is the PR target correct?
- If stacked, is the dependency chain clear?
