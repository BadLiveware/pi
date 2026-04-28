# pi-pr-upstream-status

Shows the open GitHub pull request for the current branch in Pi and can prompt the agent when new PR feedback or failing CI needs attention.

Use it when you work on branches with upstream PRs and want review comments, check status, and CI failures visible without leaving Pi.

## Install

```bash
pi install npm:@badliveware/pi-pr-upstream-status
```

## Requirements

- A Git checkout with a GitHub remote.
- Optional: `GH_TOKEN` or `GITHUB_TOKEN` for private repositories, higher rate limits, unresolved review-thread filtering, and richer CI details.
- Optional: GitHub CLI (`gh`) as an additional private-repo auth fallback.

Without a token, public-repo lookups still work with anonymous GitHub API limits. Some review-thread and CI-log details may be unavailable.

## What it shows

The extension adds a compact footer status with:

- check result: `✅`, `❌`, `⏳`, or `•`
- comment count such as `💬3`
- PR link such as `#123` when supported by the terminal

It also emits `pr-upstream:state` for footer frameworks or other extensions that want structured PR status.

## Quick use

```text
/pr-status
/pr-status refresh
/pr-autosolve off
```

Auto-solve is on by default. Turn it off if you only want passive status:

```text
/pr-autosolve off
```

## How it works

The extension detects the current branch, finds the matching open GitHub PR, refreshes status periodically, and updates Pi's footer/status primitives.

When auto-solve is enabled and Pi is idle, it can fetch new issue comments, unresolved review-thread comments, and failing CI context. It then sends the agent a prompt to verify the feedback, fix relevant issues, run validation, and summarize what happened.

Guardrails prevent automatic auto-solve from starting immediately in fresh sessions or when an older Pi process is already active in the same workspace. `/pr-autosolve now` runs a one-shot solve even when auto-solve is off and bypasses those guards intentionally.

## Commands

| Command | What it does |
| --- | --- |
| `/pr-status` | Show current PR status. |
| `/pr-status refresh` | Refresh now. |
| `/pr-status on` | Enable the periodic watcher. |
| `/pr-status off` | Disable the periodic watcher. |
| `/pr-autosolve` | Show auto-solve status and config path. |
| `/pr-autosolve on` | Enable auto-solve and persist the choice. |
| `/pr-autosolve off` | Disable auto-solve and persist the choice. |
| `/pr-autosolve now` | Run a one-shot solve for current feedback and CI failures, even when auto-solve is off. |

Auto-solve settings persist to:

```text
~/.pi/agent/pr-upstream-status.json
```

## Event payload

The extension emits:

```text
pr-upstream:state
```

Payload includes the current branch, PR number/title/url, comment count, check state, head SHA, base repo, and auto-solve state.
