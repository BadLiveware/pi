# pi-ralph-loop

Long-running iterative development loops for Pi. This first local version intentionally mirrors the behavior of `@tmustier/pi-ralph-wiggum` so it can be swapped in before we change the loop model.

Use it when a task needs repeated autonomous passes with a durable checklist, optional pacing, and explicit completion.

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

The extension preserves top-level Ralph state fields for compatibility with existing `.ralph` directories. Old state files without mode metadata are migrated to schema version 2 as `checklist` loops when loaded.

## Agent tools

| Tool | What it does |
| --- | --- |
| `ralph_start` | Create `.ralph/<name>.md`, write the task content, save loop state, and queue iteration 1. |
| `ralph_done` | Mark the current iteration complete and queue the next iteration, unless max iterations has been reached. |

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

## Commands

| Command | What it does |
| --- | --- |
| `/ralph start <name\|path>` | Start a loop from a new `.ralph/<name>.md` file or an existing task path. |
| `/ralph resume <name>` | Resume a paused loop and queue the next prompt. |
| `/ralph stop` | Pause the current loop. |
| `/ralph-stop` | Stop the active loop when the agent is idle. |
| `/ralph status` | Show active and paused loops. |
| `/ralph list --archived` | Show archived loops. |
| `/ralph archive <name>` | Move a non-active loop to `.ralph/archive/`. |
| `/ralph clean [--all]` | Remove completed loop state; `--all` also removes matching task files. |
| `/ralph cancel <name>` | Delete a loop state file. |
| `/ralph nuke [--yes]` | Delete all `.ralph` data in the workspace. |

Options for `/ralph start`:

| Option | Description |
| --- | --- |
| `--mode checklist` | Select the loop mode. `checklist` is the only implemented mode; `recursive` and `evolve` are reserved. |
| `--max-iterations N` | Stop after N iterations. Default: 50. |
| `--items-per-iteration N` | Prompt hint to process roughly N items per turn. |
| `--reflect-every N` | Insert a reflection checkpoint every N iterations. |

Press Esc to interrupt a running assistant turn. Send a normal message or use `/ralph resume <name>` to continue. Use `/ralph-stop` when idle to end the loop.

## Compatibility notes

This package is a local replacement candidate for `@tmustier/pi-ralph-wiggum`, not an additive companion. Loading both creates duplicate command/tool names. The first iteration is intentionally behavior-compatible; future iterations can change the implementation once this baseline is validated.

## Credits

This first pass is based on the MIT-licensed `@tmustier/pi-ralph-wiggum` extension by Thomas Mustier, which adapts Geoffrey Huntley's Ralph loop approach for Pi.
