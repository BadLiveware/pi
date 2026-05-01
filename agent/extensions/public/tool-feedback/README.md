# Pi Tool Feedback

Generic watched-tool feedback for Pi. It records passive per-turn summaries when selected tools are used, and can optionally ask the agent for one structured feedback record at the end of a prompt.

Use it when you are dogfooding a tool, extension, MCP server, or workflow and want low-friction signals such as “was this useful?”, “did truncation hurt?”, and “did the agent still need follow-up search?”.

## How it works

Configure tool names or prefixes to watch. The extension listens to Pi tool events, records sanitized turn summaries, and exposes a `tool_feedback` tool that the agent can call when prompted.

It does not record raw tool inputs, raw outputs, prompts, file contents, or shell commands in its JSONL log. Optional free-form notes are stored in session entries, while logs keep only note length/hash.

## Install

From a published package:

```bash
pi install @badliveware/pi-tool-feedback
```

From this repository workspace:

```bash
pi install ./agent/extensions/public/tool-feedback
```

## Configure

Create `~/.pi/agent/tool-feedback.json` for user-wide settings or `.pi/tool-feedback.json` in a project. Project config overlays user config.

Minimal example:

```json
{
  "mode": "both",
  "watch": [
    { "prefix": "code_intel_" },
    { "name": "process" }
  ]
}
```

Modes:

| Mode | Behavior |
| --- | --- |
| `off` | Disable summaries and feedback prompts. |
| `passive` | Record turn summaries only. |
| `ask-agent` | Ask for structured feedback after a prompt that used watched tools. |
| `both` | Record summaries and ask for feedback. |

Other options:

```json
{
  "excludeTools": ["tool_feedback", "tool_feedback_state"],
  "cooldownTurns": 0,
  "skipWhenPendingMessages": true,
  "appendSessionEntries": true,
  "log": true
}
```

Set `PI_TOOL_FEEDBACK_CONFIG` to load an additional config file, `PI_TOOL_FEEDBACK_DIR` to change the JSONL log directory, or `PI_TOOL_FEEDBACK_LOG` to force one log file.

Default log directory:

```text
~/.cache/pi-tool-feedback/<session-id>.jsonl
```

## Tools and command

### `tool_feedback_state`

Read-only state/config inspection. Use it to see the loaded mode, watch rules, config paths, diagnostics, and current prompt usage.

### `tool_feedback`

Records one structured feedback entry. Typical agent response after a feedback prompt:

```json
{
  "watchedTools": ["code_intel_impact_map"],
  "helped": "yes",
  "outcome": "chose_files",
  "neededFollowupSearch": false,
  "readReturnedFiles": true,
  "outputTooNoisy": false,
  "truncationHurt": false,
  "missedImportantContext": "unknown",
  "improvement": "better_summary"
}
```

### `/tool-feedback`

Show runtime status or set the runtime mode until reload:

```text
/tool-feedback
/tool-feedback off
/tool-feedback passive
/tool-feedback ask-agent
/tool-feedback both
```

## Loop prevention

The extension avoids the common feedback-loop traps:

- `tool_feedback` and `tool_feedback_state` are excluded by default.
- The active prompt is asked at most once.
- Feedback prompts are skipped when Pi already has pending messages if `skipWhenPendingMessages` is true.
- If the agent already called `tool_feedback`, no follow-up prompt is sent.

If the feedback prompt is annoying, run:

```text
/tool-feedback passive
```

or set:

```json
{ "mode": "off" }
```
