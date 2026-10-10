# pi-compaction-continue

Auto-sends a watchdog nudge when Pi stops while there may still be obvious work to resume.

Use it for long sessions where a compaction or a stalled continuation turn can leave Pi idle even though the next useful action may be to continue.

## Install

```bash
pi install npm:@badliveware/pi-compaction-continue
```

No external services, credentials, or extra CLIs are required.

## How it works

The extension watches two low-risk recovery cases and sends an automated watchdog nudge only when Pi is idle. The nudge tells the agent that it is not a new user request, to self-check completion through a dedicated tool call, and then either continue real work or stop.

Recovery cases:

- **Idle compaction:** after a compaction, Pi is idle, no messages are queued, and either the compaction followed a context overflow or the current session branch contains an unresolved/resumable Ralph prompt. A stale active Ralph state file alone (`.ralph/*.state.json`) is not enough.
- **Stalled continuation turn:** the assistant ends while saying it will continue or proceed, or it answers the watchdog self-check with `done: false` but still does not continue actual work. Fenced code blocks and blockquotes are ignored for this language check so quoted prompt examples do not count as promises to continue.

It snapshots/analyzes the branch before compaction and suppresses nudges when a Ralph loop already advanced with `ralph_done`. It does not inspect Stardock state or prompt semantics; Stardock owns its own progress and completion lifecycle. It does nothing while tools are running or messages are already queued, because that means there is no idle gap to recover. Generic stall recovery is capped to three consecutive automatic nudges until a real tool call, a non-continuation assistant reply, or a substantive new user request resets the streak. The footer status shows `watchdog:on` or `watchdog:off`.

The watchdog prompt is wrapped in a dedicated `<watchdog_nudge>` block, tells the agent not to acknowledge the nudge in prose, and scopes `done` to the whole active user-visible work set. The agent must call `watchdog_answer` first, then stop if the work set is complete or continue from the next concrete open item.

## Configuration

The watchdog is **on by default**. To disable nudges in new sessions, set:

```json
{ "enabled": false }
```

Save this in `~/.pi/agent/compaction-continue.json` for all projects, or `.pi/compaction-continue.json` for one project, then use `/reload`. Project settings override global settings. `/compaction-continue on` and `off` override the watchdog for the current session only; a new or reloaded session uses the config again.

`compaction_continue_state` reports effective `enabled`, the configured value and session override under `configuration`, loaded paths, diagnostics, and tracking state. `/compaction-continue` shows the same watchdog/config status.

## Passive tracking

Passive tracking is independent of the watchdog and **off by default**. When enabled, the extension records structured events for:

- watchdog recovery candidates it detected
- watchdog nudges it actually sent
- nudges it skipped and why
- `watchdog_answer` tool calls

Tracking can write session entries, a JSONL log, or both. Set `tracking.log: false` to stop JSONL logging while retaining session entries; set `tracking.enabled: false` to stop all passive tracking.

Enable tracking separately in the same config file:

```json
{
  "tracking": {
    "enabled": true,
    "appendSessionEntries": true,
    "log": true,
    "maxRecentEvents": 20
  }
}
```

Top-level `enabled` now controls the watchdog, not tracking. If an older config used it to enable tracking, move that flag to `tracking.enabled`. Flat `appendSessionEntries`, `log`, and `maxRecentEvents` remain accepted; nested tracking values take precedence.

Environment overrides:

- `PI_COMPACTION_CONTINUE_CONFIG` — extra config file to load first
- `PI_COMPACTION_CONTINUE_LOG` — force one JSONL log path
- `PI_COMPACTION_CONTINUE_DIR` — change the default log directory

Config files load in this order: the extra environment-config path, user-global config, then project config. Invalid files are ignored with diagnostics; previously loaded valid settings remain in effect.

## Commands

| Command | What it does |
| --- | --- |
| `/compaction-continue` | Show status, active loop detection, current assistant-stall streak, and whether passive tracking is enabled. |
| `/compaction-continue on` | Enable watchdog nudges for this session. |
| `/compaction-continue off` | Disable nudges and cancel pending recovery timers for this session. |
| `/ralph-compact-watchdog` | Compatibility alias for older local setups. |
