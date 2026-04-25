# pi-pr-upstream-status

Tracks the open upstream pull request for the current git branch (GitHub today, host abstraction ready for more providers).

## What it shows

- Branch line: adds an open PR indicator beside the branch in the footer.
- PR link: PR number is rendered as an OSC-8 hyperlink (`#123`) when terminal support is available.
- Status line: compact `pr:` summary with:
  - `💬<count>` total of issue comments + review comments
  - check result icon (`✅`, `❌`, `⏳`, or `•` unknown)

## Provider model

The extension uses a generalized `CodeHostProvider` interface and currently ships one implementation:

- `github` provider (GitHub REST API)

Adding a new host means implementing `parseRepo()` and `findOpenPullRequest()`.

## Auth

For private repositories or better rate limits, set one of:

- `GH_TOKEN`
- `GITHUB_TOKEN`

Without a token, public-repo lookups still work with anonymous API limits.

## Auto-solve PR comments (default: off)

When enabled, the extension waits until:

- the PR checks are complete (`pass` or `fail`), and
- Pi is idle with no pending messages,

then fetches new PR comments and sends a prompt that asks the agent to:

1. verify each comment is true/relevant,
2. ignore comments that are not true/relevant (with explanation),
3. apply fixes for relevant comments.

## Commands

- `/pr-status` – show current PR status summary
- `/pr-status refresh` – force refresh now
- `/pr-status on` – enable periodic watcher
- `/pr-status off` – disable periodic watcher
- `/pr-autosolve` – show auto-solve status (default off)
- `/pr-autosolve on` – enable auto-solve
- `/pr-autosolve off` – disable auto-solve
- `/pr-autosolve now` – force an immediate auto-solve pass (must be enabled)
