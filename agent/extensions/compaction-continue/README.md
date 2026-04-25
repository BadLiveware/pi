# pi-compaction-continue

Auto-continue extension for [Pi](https://pi.dev) after compaction leaves the agent idle.

## Features

When Pi compacts context and then becomes idle with no queued messages, this extension sends a plain:

```text
continue
```

It does this for:

- provider `context_length_exceeded` overflow compactions, and
- active loop state under `.ralph/*.state.json`.

It checks `ctx.isIdle()` and `!ctx.hasPendingMessages()` before sending anything, so it should not interfere with running tool calls.

The footer status shows `watchdog:on` or `watchdog:off`.

## Install

From npm after publishing:

```bash
pi install npm:pi-compaction-continue
```

From a local checkout:

```bash
pi install /path/to/pi-compaction-continue
```

For one-off testing:

```bash
pi -e /path/to/pi-compaction-continue
```

## Commands

- `/compaction-continue` — show status.
- `/compaction-continue on` — enable auto-continue.
- `/compaction-continue off` — disable auto-continue.
- `/ralph-compact-watchdog` — compatibility alias.
