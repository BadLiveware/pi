# pi-compaction-continue

Auto-sends a watchdog nudge when Pi stops while there may still be obvious work to resume.

Use it for long sessions, especially active iterative loops, where a compaction or stalled Ralph turn can leave Pi idle even though the next useful action may be to continue.

## Install

```bash
pi install npm:@badliveware/pi-compaction-continue
```

No external services, credentials, or extra CLIs are required.

## How it works

The extension watches two low-risk recovery cases and sends an automated watchdog nudge. The nudge tells the agent that it is not a new user request, to check whether work actually remains, and to stop instead of continuing when the task is already complete.

Recovery cases:

- **Idle compaction:** after a compaction, Pi is idle, no messages are queued, and either the compaction followed a context overflow or the current session branch contains an unresolved/resumable Ralph prompt. A stale active `.ralph/*.state.json` file alone is not enough.
- **Stalled Ralph turn:** after a Ralph loop prompt, the assistant ends while saying it will continue or proceed, but has not called `ralph_done` or completed the loop.

It snapshots/analyzes the branch before compaction and suppresses nudges when Ralph already advanced with `ralph_done`. It does nothing while tools are running or messages are already queued. Ralph stall recovery is capped to one automatic nudge per Ralph prompt to avoid noisy loops. The footer status shows `watchdog:on` or `watchdog:off`.

The prompt includes the Ralph completion marker instruction, so a finished Ralph loop can answer `<promise>COMPLETE</promise>` rather than inventing extra work.

## Commands

| Command | What it does |
| --- | --- |
| `/compaction-continue` | Show status, active loop detection, and whether Ralph idle watch is armed. |
| `/compaction-continue on` | Enable auto-continue. |
| `/compaction-continue off` | Disable auto-continue. |
| `/ralph-compact-watchdog` | Compatibility alias for older local setups. |
