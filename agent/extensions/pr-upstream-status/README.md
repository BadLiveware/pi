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

## Commands

- `/pr-status` – show current PR status summary
- `/pr-status refresh` – force refresh now
- `/pr-status on` – enable periodic watcher
- `/pr-status off` – disable periodic watcher
