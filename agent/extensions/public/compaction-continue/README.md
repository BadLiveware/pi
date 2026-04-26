# pi-compaction-continue

Auto-sends `continue` when Pi compacts context and then stops while there is still obvious work to resume.

Use it for long sessions, especially active iterative loops, where a compaction can leave Pi idle even though the next useful action is simply to continue.

## Install

```bash
pi install npm:@badliveware/pi-compaction-continue
```

No external services, credentials, or extra CLIs are required.

## How it works

After a compaction, the extension waits briefly and checks that Pi is idle and has no queued messages. If the compaction was caused by a context overflow, or if an active Ralph loop is recorded under `.ralph/*.state.json`, it sends:

```text
continue
```

It does nothing while tools are running or messages are already queued. The footer status shows `watchdog:on` or `watchdog:off`.

## Commands

| Command | What it does |
| --- | --- |
| `/compaction-continue` | Show status and active loop detection. |
| `/compaction-continue on` | Enable auto-continue. |
| `/compaction-continue off` | Disable auto-continue. |
| `/ralph-compact-watchdog` | Compatibility alias for older local setups. |
