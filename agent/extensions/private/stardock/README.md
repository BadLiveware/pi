# Stardock

Private Pi implementation framework for governed agentic work. Stardock currently provides long-running checklist and recursive loops, and is the local home for the broader framework work: criteria, compact context packets, evidence, governor/auditor checkpoints, and bounded workers.

This extension is private to this repository. It is not packaged for public install.

Architecture diagrams: see [`docs/architecture-diagrams.md`](docs/architecture-diagrams.md).

## Local layout

- Extension source: `agent/extensions/private/stardock/`
- Registered from: `agent/extensions/package.json`
- State directory: `.stardock/`
- Source layout: `index.ts` owns extension orchestration and shared command/tool registration; `src/state.ts` holds shared state/persistence helpers; feature slices such as `src/final-reports.ts` keep feature-owned migration, formatting, behavior, schemas, and registration together.

Stardock stores loop state in the current workspace, with one folder per run:

- `.stardock/runs/<name>/task.md` — task file with goals, checklist, notes, and verification evidence.
- `.stardock/runs/<name>/state.json` — loop state, iteration count, pacing, mode state, attempts, and outside requests.
- `.stardock/archive/<name>/` — archived run folder with the same `task.md` / `state.json` shape.

The older flat layout, `.stardock/<name>.md` plus `.stardock/<name>.state.json`, remains readable for local resilience, but new and archived managed runs use per-run folders.

## Agent tools

| Tool | What it does |
| --- | --- |
| `stardock_start` | Create `.stardock/runs/<name>/task.md`, write task content, save loop state, and queue iteration 1. |
| `stardock_done` | Mark the current iteration complete and queue the next iteration, unless max iterations has been reached. Accepts opt-in `briefLifecycle` cleanup for the active brief. |
| `stardock_state` | List loops or inspect one loop's compact structured state without reading `.stardock/` files directly. Use `view: "overview"` or `view: "timeline"` for operational views. Includes criteria, active brief, and verification artifact counts. |
| `stardock_ledger` | Inspect or update the loop's criterion ledger and compact verification artifact refs. Supports `list`, `upsertCriterion`, `upsertCriteria`, `recordArtifact`, and `recordArtifacts`, with optional post-mutation state/overview details. |
| `stardock_brief` | Inspect or update manual or governor-sourced IterationBrief context packets. Supports `list`, `upsert`, `activate`, `clear`, and `complete`; `upsert` can also activate the brief and return optional state or prompt preview details. |
| `stardock_final_report` | Record or inspect compact final verification reports with criteria coverage, validation records, artifact refs, unresolved gaps, and risk notes. |
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

Use `/stardock view [loop]` when you want to know what is happening in more detail. It summarizes the run status, objective, attempts, outside requests, criteria, verification artifact counts, latest governor decision, and a chronological timeline. Use `/stardock timeline [loop]` when you only want the event sequence.

Use `stardock_ledger` when a loop needs explicit acceptance criteria or compact evidence refs. Criteria keep stable IDs, source/requirement context, pass conditions, status, and compact evidence. Verification artifacts store summaries plus optional commands, paths, and linked criterion IDs; put long logs, screenshots, and benchmark output in files and reference them rather than pasting them into state. Use `upsertCriteria` or `recordArtifacts` when seeding or updating several items, and set `includeState` or `includeOverview` when the next step would otherwise be an immediate `stardock_state` call.

Use `stardock_brief` when a loop needs a selected context packet for the next bounded attempt. A brief carries objective/task text, selected criterion IDs, acceptance criteria, verification requirements, required context, constraints, avoid-list items, source refs, and an output contract. Prompts include the active brief only when one is activated; loops without an active brief keep the normal checklist or recursive prompt shape. For the common create-and-use workflow, call `stardock_brief({ action: "upsert", activate: true, includeState: true })`; add `includePromptPreview: true` when you need to inspect the next prompt shape without waiting for another loop turn.

Briefs default to `source: "manual"`. Use `source: "governor"` plus an optional `requestId` that points at a `governor_review` outside request when a governor decision selected the bounded context. Governor-sourced briefs are still explicit data records: Stardock does not call a model, distill plans automatically, spawn workers, or activate a brief unless the tool call uses `activate: true` or a separate `activate` action.

When finishing an iteration, `stardock_done` keeps the active brief by default. Pass `briefLifecycle: "complete"` to mark the active brief completed and return the next prompt to the normal task shape, or `briefLifecycle: "clear"` to deactivate it back to draft without marking it done. Add `includeState: true` when you want the lifecycle result and compact loop summary in the same tool response.

Use `stardock_final_report` near completion to record a bounded evidence summary. Reports can link criteria and artifact IDs, include compact validation records with `passed`/`failed`/`skipped` results, list unresolved gaps, and capture compatibility/security/performance notes. Reports are manual and optional in this slice: Stardock does not require one before completion, run validators, call models, or paste long logs/screenshots into state.

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
