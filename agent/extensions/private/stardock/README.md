# Stardock

Private Pi implementation framework for governed agentic work. Stardock currently provides long-running checklist and recursive loops, and is the local home for the broader framework work: criteria, compact context packets, evidence, governor/auditor checkpoints, and bounded workers.

This extension is private to this repository. It is not packaged for public install.

Architecture diagrams: see [`docs/architecture-diagrams.md`](docs/architecture-diagrams.md).

## Local layout

- Extension source: `agent/extensions/private/stardock/`
- Registered from: `agent/extensions/package.json`
- State directory: `.stardock/`

Stardock stores loop state in the current workspace, with one folder per run:

- `.stardock/runs/<name>/task.md` — task file with goals, checklist, notes, and verification evidence.
- `.stardock/runs/<name>/state.json` — loop state, iteration count, pacing, mode state, attempts, and outside requests.
- `.stardock/archive/<name>/` — archived run folder with the same `task.md` / `state.json` shape.

The older flat layout, `.stardock/<name>.md` plus `.stardock/<name>.state.json`, remains readable for local resilience, but new and archived managed runs use per-run folders.

## Agent tools

| Tool | What it does |
| --- | --- |
| `stardock_start` | Create `.stardock/runs/<name>/task.md`, write task content, save loop state, and queue iteration 1. |
| `stardock_done` | Mark the current iteration complete and queue the next iteration, unless max iterations has been reached. |
| `stardock_state` | List loops or inspect one loop's compact structured state without reading `.stardock/` files directly. Use `view: "overview"` or `view: "timeline"` for operational views. |
| `stardock_attempt_report` | Record structured hypothesis/action/validation/result data for one recursive attempt. |
| `stardock_govern` | Create or reuse a manual governor review request and return its payload. |
| `stardock_outside_requests` | List pending or answered outside-help/governor requests for a loop. |
| `stardock_outside_payload` | Return a ready-to-copy governor or researcher task payload for one outside request. |
| `stardock_outside_answer` | Record an outside-help answer or structured governor decision without editing state files manually. |

## Commands

| Command | What it does |
| --- | --- |
| `/stardock start <name\|path>` | Start a loop from a new `.stardock/runs/<name>/task.md` file or an existing task path. |
| `/stardock resume <name>` | Resume a paused loop and queue the next prompt. |
| `/stardock stop` | Pause the current loop. |
| `/stardock-stop` | Stop the active loop when the agent is idle. |
| `/stardock status` | Show active and paused loops. |
| `/stardock view [loop] [--archived]` | Show what is happening in a run: status, objective, progress, latest governor decision, and timeline. |
| `/stardock timeline [loop] [--archived]` | Show only the run timeline. |
| `/stardock list --archived` | Show archived loops. |
| `/stardock govern [loop]` | Create or reuse a manual governor review request and show its payload. |
| `/stardock outside [loop]` | Show outside-help/governor requests for a loop. |
| `/stardock outside payload <loop> <request-id>` | Show a ready-to-copy governor or researcher task payload. |
| `/stardock outside answer <loop> <request-id> <answer>` | Record a plain-text answer for an outside request. |
| `/stardock archive <name>` | Move a non-active managed loop to `.stardock/archive/<name>/`. |
| `/stardock clean [--all]` | Remove completed loop state; `--all` also removes matching task files. |
| `/stardock cancel <name>` | Delete a loop state file. |
| `/stardock nuke [--yes]` | Delete all `.stardock` data in the workspace. |

Options for `/stardock start`:

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
| `--outside-help-every N` | Recursive cue interval for requesting outside help. Also acts as governor cadence when `governEvery` is omitted. |
| `--govern-every N` | Recursive interval for governor review requests. |
| `--outside-help-on-stagnation` | Cue outside help when structured attempt results stagnate or show scaffolding drift. |

## Understanding a run

While a loop is active, Stardock also shows an at-a-glance widget with loop name, mode/status/iteration, recursive attempt progress, outside request count, and the latest governor steer when present.

Use `/stardock view [loop]` when you want to know what is happening in more detail. It summarizes the run status, objective, attempts, outside requests, latest governor decision, and a chronological timeline. Use `/stardock timeline [loop]` when you only want the event sequence.

Agents can request the same views through `stardock_state`:

```js
stardock_state({ loopName: "run-name", view: "overview" })
stardock_state({ loopName: "run-name", view: "timeline" })
```

## Modes

### `checklist`

Finite known work. The agent updates the task file and either calls `stardock_done` for the next iteration or outputs:

```text
<promise>COMPLETE</promise>
```

### `recursive`

Open-ended bounded attempts. Each iteration should test one hypothesis, record evidence, and either complete or call `stardock_done` for the next attempt. Use `stardock_attempt_report` for structured attempt records.

Recursive loops create data-only `governor_review` requests at `governEvery`; when `governEvery` is omitted, `outsideHelpEvery` preserves the same governor-cadence behavior. Governor requests are one-per-iteration: a manual governor request/decision suppresses the automatic cadence request for that same iteration. With `outsideHelpOnStagnation`, repeated non-improving structured attempt results create a `failure_analysis` request, and repeated setup/refactor/instrumentation/benchmark-scaffold attempts create a `mutation_suggestions` request.

The extension does not spawn subagents. A parent/orchestrator agent can inspect requests, fetch a ready-to-copy task with `stardock_outside_payload` or `/stardock outside payload`, run whatever research or review is appropriate, then record the result with `stardock_outside_answer` or `/stardock outside answer`.

## Development notes

This private extension was moved from the local Ralph loop implementation. Backward compatibility with `ralph_*`, `/ralph`, or `.ralph/` is not a requirement.

After changing the extension:

```bash
npm run typecheck --prefix agent/extensions
npm test --prefix agent/extensions -- private/stardock/index.test.ts
./link-into-pi-agent.sh
```

Reload/restart Pi to pick up command/tool/skill changes.

## Credits

The first local loop implementation was based on the MIT-licensed `@tmustier/pi-ralph-wiggum` extension by Thomas Mustier, which adapts Geoffrey Huntley's Ralph loop approach for Pi.
