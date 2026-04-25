# pi-pr-upstream-status

Tracks the open upstream pull request for the current git branch (GitHub today, host abstraction ready for more providers).

## What it shows

- Default footer status entry (`ctx.ui.setStatus`) with:
  - check result icon (`✅`, `❌`, `⏳`, or `•` unknown)
  - optional `💬<count>` (issue + review comments)
  - PR link (`#123`) as OSC-8 hyperlink when supported
- Emits `pr-upstream:state` event bus primitives for custom footer extensions.

## Provider model

The extension uses a generalized `CodeHostProvider` interface and currently ships one implementation:

- `github` provider (GitHub REST API)

Adding a new host means implementing `parseRepo()`, `findOpenPullRequest()`, and `fetchOpenFeedback()`.

## Auth

For private repositories or better rate limits, set one of:

- `GH_TOKEN`
- `GITHUB_TOKEN`

Without a token, public-repo lookups still work with anonymous API limits.

For private repos:
- the extension first tries REST auth from env tokens,
- then optionally tries `gh auth token` as an auth source (if `gh` is installed/logged in),
- and finally falls back to `git ls-remote refs/pull/*/head` to detect the PR number without requiring `gh`.

## Auto-solve PR comments (default: off)

When enabled, the extension waits until:

- the PR checks are complete (`pass` or `fail`), and
- Pi is idle with no pending messages,

then fetches new PR comments and sends a prompt that asks the agent to:

1. verify each comment is true/relevant,
2. ignore comments that are not true/relevant (with explanation),
3. apply fixes for relevant comments.

## Event primitive

The extension emits:

- `pr-upstream:state`

Payload fields include branch, PR metadata (number/url/comments/checks), and auto-solve state.

## Commands

- `/pr-status` – show current PR status summary
- `/pr-status refresh` – force refresh now
- `/pr-status on` – enable periodic watcher
- `/pr-status off` – disable periodic watcher
- `/pr-autosolve` – show auto-solve status (default off)
- `/pr-autosolve on` – enable auto-solve
- `/pr-autosolve off` – disable auto-solve
- `/pr-autosolve now` – force an immediate auto-solve pass (must be enabled)
