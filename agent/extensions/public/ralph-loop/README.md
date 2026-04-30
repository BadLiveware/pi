# pi-ralph-loop

Long-running iterative development loops for Pi. The default `checklist` mode preserves the behavior of `@tmustier/pi-ralph-wiggum`; `recursive` mode adds bounded attempt loops for open-ended search.

Use it when a task needs repeated autonomous passes with a durable checklist, optional pacing, explicit completion, or bounded try/test/reset attempts.

## Install

```bash
pi install npm:@badliveware/pi-ralph-loop
```

For local dogfooding from this repository, replace the existing `npm:@tmustier/pi-ralph-wiggum` package in `~/.pi/agent/settings.json` with this package/path before reloading. Do not load both packages at the same time: both expose `/ralph`, `/ralph-stop`, `ralph_start`, and `ralph_done`.

No external services, credentials, or extra CLIs are required.

## How it works

The extension stores loop state in the current workspace under `.ralph/`:

- `.ralph/<name>.md` — task file with goals, checklist, notes, and verification evidence.
- `.ralph/<name>.state.json` — loop state, iteration count, pacing, and reflection settings.
- `.ralph/archive/` — archived loop state/task files.

A loop sends an iteration prompt to the agent. The agent works on the task file, records progress, then either calls `ralph_done` for the next iteration or outputs:

```text
<promise>COMPLETE</promise>
```

The extension preserves top-level Ralph state fields for compatibility with existing `.ralph` directories. Old state files without mode metadata are migrated to schema version 2 as `checklist` loops when loaded. Recursive loops store their objective, validation/reset policy, stop criteria, attempt reports, and pending outside requests in state.

## Agent tools

| Tool | What it does |
| --- | --- |
| `ralph_start` | Create `.ralph/<name>.md`, write the task content, save loop state, and queue iteration 1. |
| `ralph_done` | Mark the current iteration complete and queue the next iteration, unless max iterations has been reached. |
| `ralph_attempt_report` | Record structured hypothesis/action/validation/result data for one recursive attempt. |
| `ralph_outside_requests` | List pending or answered outside-help/governor requests for a loop. |
| `ralph_outside_answer` | Record an outside-help answer or structured governor decision without editing state files manually. |

Example:

```json
{
  "name": "refactor-auth",
  "mode": "checklist",
  "taskContent": "# Task\n\n## Goals\n- Improve auth boundaries\n\n## Checklist\n- [ ] Map current flow\n- [ ] Refactor handler",
  "itemsPerIteration": 3,
  "reflectEvery": 10,
  "maxIterations": 50
}
```

Recursive example:

```json
{
  "name": "search-latency",
  "mode": "recursive",
  "taskContent": "# Improve search latency\n\n## Verification\n- Record each attempt and benchmark result.",
  "objective": "Reduce query latency without hurting recall",
  "baseline": "p95 120ms",
  "validationCommand": "npm run bench:search",
  "resetPolicy": "keep_best_only",
  "stopWhen": ["target_reached", "idea_exhaustion", "max_iterations"],
  "maxIterations": 10,
  "outsideHelpEvery": 3
}
```

## Commands

| Command | What it does |
| --- | --- |
| `/ralph start <name\|path>` | Start a loop from a new `.ralph/<name>.md` file or an existing task path. |
| `/ralph resume <name>` | Resume a paused loop and queue the next prompt. |
| `/ralph stop` | Pause the current loop. |
| `/ralph-stop` | Stop the active loop when the agent is idle. |
| `/ralph status` | Show active and paused loops. |
| `/ralph list --archived` | Show archived loops. |
| `/ralph outside [loop]` | Show outside-help/governor requests for a loop. |
| `/ralph outside answer <loop> <request-id> <answer>` | Record a plain-text answer for an outside request. |
| `/ralph archive <name>` | Move a non-active loop to `.ralph/archive/`. |
| `/ralph clean [--all]` | Remove completed loop state; `--all` also removes matching task files. |
| `/ralph cancel <name>` | Delete a loop state file. |
| `/ralph nuke [--yes]` | Delete all `.ralph` data in the workspace. |

Options for `/ralph start`:

| Option | Description |
| --- | --- |
| `--mode checklist\|recursive` | Select the loop mode. `evolve` is reserved. |
| `--max-iterations N` | Stop after N iterations. Default: 50. |
| `--items-per-iteration N` | Prompt hint to process roughly N items per turn. |
| `--reflect-every N` | Insert a reflection checkpoint every N iterations. |
| `--objective TEXT` | Required for `--mode recursive`; describes the target outcome. |
| `--baseline TEXT` | Optional recursive baseline/current best evidence. |
| `--validation-command CMD` | Optional recursive validation command or check. |
| `--reset-policy manual\|revert_failed_attempts\|keep_best_only` | Recursive reset policy. Default: `manual`. |
| `--stop-when A,B` | Recursive stop criteria. Defaults to target reached, idea exhaustion, or max iterations. |
| `--max-failed-attempts N` | Recursive failed-attempt budget. |
| `--outside-help-every N` | Recursive cue interval for requesting outside help. |
| `--outside-help-on-stagnation` | Cue outside help when attempts stagnate. |

Recursive attempts can be reported with `ralph_attempt_report`, including kind (`candidate_change`, `setup`, `refactor`, `instrumentation`, `benchmark_scaffold`, `research`, or `other`), hypothesis, action summary, validation, result (`improved`, `neutral`, `worse`, `invalid`, or `blocked`), keep/reset decision, evidence, and follow-up ideas. Recent reports are summarized in the next recursive prompt.

Recursive loops with `outsideHelpEvery` create data-only `governor_review` requests at the configured interval. The extension does not spawn subagents; a parent/orchestrator agent can inspect requests, run whatever research or review is appropriate, then record the result with `ralph_outside_answer` or `/ralph outside answer`. Structured governor answers can include a verdict, rationale, required next move, forbidden next moves, and evidence gaps; the next recursive prompt includes the latest steer.

Press Esc to interrupt a running assistant turn. Send a normal message or use `/ralph resume <name>` to continue. Use `/ralph-stop` when idle to end the loop.

## Compatibility notes

This package is a local replacement candidate for `@tmustier/pi-ralph-wiggum`, not an additive companion. Loading both creates duplicate command/tool names. The first iteration is intentionally behavior-compatible; future iterations can change the implementation once this baseline is validated.

## Credits

This first pass is based on the MIT-licensed `@tmustier/pi-ralph-wiggum` extension by Thomas Mustier, which adapts Geoffrey Huntley's Ralph loop approach for Pi.
