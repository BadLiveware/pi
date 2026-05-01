# Pi Tool Feedback

Generic watched-tool feedback for Pi. It records passive per-turn summaries when selected tools are used, and can optionally queue a non-user feedback task for the agent at the end of a prompt.

Use it when you are dogfooding a tool, extension, MCP server, or workflow and want low-friction subjective signals such as “did this feel useful?”, “did output feel incomplete or noisy?”, and “would the agent use it again?”. Objective trace facts such as truncation and follow-up tool categories stay in passive summaries.

## How it works

Configure tool names or prefixes to watch. The extension listens to Pi tool events, records sanitized turn summaries, and exposes a `tool_feedback` tool that the agent can call when prompted. Active feedback requests are delivered as Pi custom messages with `triggerTurn`, not as user messages. The request names the watched tools but does not include trace-derived facts, so the agent's self-report is less anchored by telemetry the extension already knows.

It does not record raw tool inputs, raw outputs, prompts, file contents, or shell commands in its JSONL log. Optional free-form notes are stored in session entries, while logs keep only note length/hash.

## What feedback can and cannot tell you

Agent self-feedback is useful as noisy operational feedback, not as a faithful explanation of the model's hidden reasoning. Treat it like a lightweight post-task survey and compare it with trace data.

Good questions ask about the agent's observable experience:

- Was the output useful, incomplete, noisy, or too slow?
- Would you use this tool again in a similar situation?
- Was follow-up work routine or did it feel compensatory?
- What one missing capability or improvement would help most?
- How confident are you in this report?

Weak questions ask the agent to reconstruct why its internal reasoning happened:

- What was the real causal contribution of this tool to your final answer?
- Which hidden prompt feature or bias changed your reasoning?
- Did your chain-of-thought faithfully describe the reason you chose an action?
- Exactly how much would the outcome have changed without this tool?

The extension therefore keeps objective trace facts in passive summaries and asks active prompts for subjective/counterfactual judgments. Use self-reports as candidate design signals, not ground truth.

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

### Extra feedback fields

The built-in feedback schema stays stable, but you can add project- or user-specific fields. The active prompt lists these fields and agents answer them inside `fieldResponses`.

```json
{
  "mode": "both",
  "watch": [{ "prefix": "code_intel_" }],
  "feedbackFields": [
    {
      "name": "rankingQuality",
      "type": "enum",
      "values": ["good", "mixed", "poor", "unknown"],
      "required": true,
      "description": "How good was result ranking?"
    },
    {
      "name": "latencyAcceptable",
      "type": "yes_no_unknown"
    }
  ]
}
```

Supported field types:

| Type | Accepted values |
| --- | --- |
| `enum` | one of the configured `values` |
| `yes_no_unknown` | `yes`, `no`, or `unknown` |
| `boolean` | JSON boolean |
| `number` | finite JSON number |

Field names must match `/^[a-zA-Z][a-zA-Z0-9_]*$/`. Invalid, unknown, or missing required field responses are recorded in `fieldResponseErrors`; invalid values are not stored in `fieldResponses`.

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
  "perceivedUsefulness": "medium",
  "wouldUseAgainSameSituation": "yes",
  "followupWasRoutine": "yes",
  "followupNeededBecauseToolWasInsufficient": "unknown",
  "outputSeemedTooNoisy": "no",
  "outputSeemedIncomplete": "yes",
  "missedImportantContext": "unknown",
  "confidence": "medium",
  "improvement": "better_summary",
  "fieldResponses": {
    "rankingQuality": "mixed"
  }
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
