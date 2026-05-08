# Stardock

Stardock is a private Pi workflow extension for agentic work that is too large, iterative, or risk-prone for a single chat turn. It targets recurring failure modes: agents losing scope across turns, treating checklist progress as completion evidence, piling on attempts without a measured decision, and handling review/governor/context handoffs ad hoc.

It solves those problems by turning work into governed loops with compact state. Checklist mode scopes finite work through bounded iteration briefs, criteria, and evidence. Recursive mode runs one evaluated hypothesis per iteration. Stardock also extends the useful lifetime of outside-agent context: implementation delegation, worker reports, handoff records, and compact evidence packets preserve the minimum information another worker, auditor, governor, or future resumed agent needs to understand the work without inheriting the whole chat. Ledgers, attempt reports, final reports, auditor/breakout records, outside requests, and policy checks keep validation, decisions, and oversight inspectable without making raw chat history or `.stardock` files the only durable project knowledge.

This extension is private to this repository. It is not packaged for public install.

Architecture diagrams: see [`docs/architecture-diagrams.md`](docs/architecture-diagrams.md).

## Local layout

- Extension source: `agent/extensions/private/stardock/`
- Registered from: `agent/extensions/package.json`
- State directory: `.stardock/`
- Source layout: `index.ts` is a thin extension entrypoint and `src/runtime/` owns Pi-facing lifecycle, commands, hooks, prompts, UI, tool registration, and followup adapters. Shared state code lives under `src/state/` (`core.ts`, `paths.ts`, `migration.ts`, `store.ts`). Vertical feature slices keep feature-owned formatting, schemas, payload/list behavior, and tool registration together, while `src/app/*-tool.ts` modules hold Pi-free mutation orchestration for batch/write paths.

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
| `stardock_state` | List loops or inspect one loop's compact structured state without reading `.stardock/` files directly. Use `view: "overview"` or `view: "timeline"` for operational views. Includes criteria, active brief, verification artifact counts, derived workflow status, and advisory task-checklist/ledger drift. |
| `stardock_ledger` | Inspect or update the loop's criterion ledger, compact verification artifact refs, and baseline validation records. Supports `list`, `distillTaskCriteria`, `upsertCriterion`, `upsertCriteria`, `recordArtifact`, `recordArtifacts`, `recordBaseline`, and `recordBaselines`, with optional post-mutation state/overview details. |
| `stardock_brief` | Inspect or update manual or governor-sourced IterationBrief context packets. Supports `list`, `payload`, `upsert`, `activate`, `clear`, and `complete`; `payload` builds a provider-neutral advisory worker task without running providers, `upsert` accepts `briefs`, `complete` accepts `ids`, and `upsert` can activate the final upserted brief and return optional state or prompt preview details. |
| `stardock_final_report` | Record or inspect compact final verification reports with criteria coverage, validation records, artifact refs, unresolved gaps, and risk notes. `record` accepts `reports`. |
| `stardock_advisory_adapter` | Build ready-to-run parent-owned explorer/test-runner adapter payloads, currently formatted for `pi-subagents`, without executing providers, persisting provider-specific state, or applying edits. |
| `stardock_handoff` | Build provider-neutral advisory handoff payloads and record compact returned results. Supports `list`, `payload`, and `record`; `record` accepts `handoffs`; it does not execute providers and keeps provider metadata optional/opaque. |
| `stardock_auditor` | Build ready-to-copy manual auditor review payloads and record compact auditor review results. Supports `list`, `payload`, and `record`; `record` accepts `reviews`; v1 is data-only and does not call models, spawn subagents, or block completion. |
| `stardock_breakout` | Build manual breakout decision payloads and record compact breakout packages for stuck or blocked loops. Supports `list`, `payload`, and `record`; `record` accepts `packages`; v1 is data-only and does not trigger escalation or block completion automatically. |
| `stardock_policy` | Inspect read-only governance policy recommendations. Supports `completion` readiness checks plus `auditor`, `breakout`, `parentReview`, and `auditorGate` trigger checks without enforcing gates, spawning reviewers, or stopping loops. |
| `stardock_worker_report` | Build provider-neutral WorkerReport payloads and record compact worker results with changed files, validation, risks, questions, next moves, and review hints. `record` accepts `reports`. |
| `stardock_attempt_report` | Record structured hypothesis/action/validation/result data for recursive attempts. Accepts `reports`. |
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

Use `stardock_ledger` when a loop needs explicit acceptance criteria, compact evidence refs, or pre-change baseline validation records. Criteria keep stable IDs, source/requirement context, pass conditions, status, and compact evidence. `distillTaskCriteria` deterministically derives criteria from the loop task file's checklist items, or goal/requirement bullets when no checklist exists, without rewriting the canonical task file; treat it as a starter pass that can be refined with explicit `upsertCriterion` calls. Verification artifacts store summaries plus optional commands, paths, and linked criterion IDs; put long logs, screenshots, and benchmark output in files and reference them rather than pasting them into state. Artifact kinds are `test`, `smoke`, `curl`, `browser`, `screenshot`, `walkthrough`, `benchmark`, `log`, `url`, `pr`, `diff`, `command`, `document`, and `other`; input aliases normalize `doc` to `document` and `manual` to `other`. Baseline validations record the command/check, result, summary, linked criteria, and artifact IDs before worker or implementation attempts so later evidence can distinguish pre-existing failures from new regressions. Use `upsertCriteria`, `recordArtifacts`, or `recordBaselines` when seeding or updating several items, and set `includeState` or `includeOverview` when the next step would otherwise be an immediate `stardock_state` call.

`stardock_state` reports likely task-checklist/ledger drift when confident matches disagree, such as a passed criterion whose Markdown checkbox remains unchecked or a checked task item whose criterion is still pending. Drift is advisory and read-only; update the task file or ledger explicitly when the difference is meaningful.

Use `stardock_brief` when a loop needs a selected context packet for the next bounded attempt. A brief carries objective/task text, selected criterion IDs, acceptance criteria, verification requirements, required context, constraints, avoid-list items, source refs, and an output contract. Prompts include the active brief only when one is activated; loops without an active brief keep the normal checklist or recursive prompt shape. Use `stardock_brief({ action: "payload" })` to build a provider-neutral advisory worker task from the active brief for parent-orchestrated explorers, test runners, researchers, reviewers, governors, or auditors; this does not run providers, spawn agents, mutate state, or apply edits. For the common create-and-use workflow, call `stardock_brief({ action: "upsert", activate: true, includeState: true })`; add `includePromptPreview: true` when you need to inspect the next prompt shape without waiting for another loop turn. `upsert` also accepts `briefs: [...]` for batch creation/update, and `complete` accepts `ids: [...]`; single-item fields remain compatibility sugar for one-item batches.

Briefs default to `source: "manual"`. Use `source: "governor"` plus an optional `requestId` that points at a `governor_review` outside request when a governor decision selected the bounded context. Governor-sourced briefs are still explicit data records: Stardock does not call a model, distill plans automatically, spawn workers, or activate a brief unless the tool call uses `activate: true` or a separate `activate` action.

When finishing an iteration, `stardock_done` keeps the active brief by default. When the active brief's criteria are satisfied and more work remains, prefer `stardock_done({ briefLifecycle: "complete", includeState: true })` to mark the brief completed and queue the next prompt in one call. Use `briefLifecycle: "clear"` to deactivate a brief back to draft without marking it done.

Use `stardock_final_report` near completion to record a bounded evidence summary. Reports use status `draft`, `passed`, `failed`, `partial`, `blocked`, or `skipped`; `blocked` means the scoped verification cannot proceed until an external prerequisite exists, and `skipped` means it was intentionally not run. Reports can link criteria and artifact IDs, include compact validation records with `passed`/`failed`/`skipped` results, list unresolved gaps, and capture compatibility/security/performance notes. `record` accepts `reports: [...]` for batch writes; single-report fields remain compatibility sugar for one-item batches. Reports are manual and optional in this slice: Stardock does not require one before completion, run validators, call models, or paste long logs/screenshots into state.

Use `stardock_auditor` when a bounded oversight review should inspect the evidence trail. `payload` returns a ready-to-copy auditor task with compact criteria, artifact, final-report, attempt, and governor/outside-request context. `record` stores compact manual auditor results with status `draft`, `passed`, `concerns`, or `blocked`, plus summary, focus, linked criteria/artifacts/final reports, concerns, recommendations, and required follow-ups; pass `reviews: [...]` for batch writes or single-review fields for a one-item batch. `list` inspects recorded reviews. Auditor v1 is manual and data-only: it does not call a model, spawn subagents, mutate implementation state, or enforce completion gates automatically.

Use `stardock_handoff` when a future worker/reviewer/researcher/explorer handoff needs a provider-neutral payload and durable result record. The handoff contract uses Stardock-owned fields such as role, objective, selected criteria/artifacts/final reports, context refs, constraints, requested output, result summary, concerns, recommendations, and artifact refs. `record` accepts status `draft`, `requested`, `answered`, `failed`, or `dismissed`, and `handoffs: [...]` for batch writes; single-handoff fields remain compatibility sugar. Provider-specific run/session/transcript/model details belong only in optional opaque `provider` metadata and are not the source of truth. This slice is a decoupling firewall: it does not call `pi-subagents`, spawn agents, call models, run processes, or apply returned edits.

Use `stardock_breakout` when a loop is stuck, blocked, repeatedly failing criteria, or lacking enough evidence to continue honestly. `payload` builds a compact decision package for a user, governor, auditor, or advisor; `record` stores compact packages with status `draft`, `open`, `resolved`, or `dismissed`, plus linked criteria, attempts, artifacts, final reports, auditor reviews, advisory handoffs, outside requests, last errors, suspected root causes, `requestedDecision`, `resumeCriteria`, and `recommendedNextActions`; input status `blocked` normalizes to `open` because the breakout package represents the unresolved blocked decision. Pass `packages: [...]` for batch writes or single-package fields for one-item batches. `list` inspects packages. Do not pass `objective`; use `summary` for the stuck context and `requestedDecision` for the decision needed. Breakout packages are evidence and decision handoffs, not automation: v1 does not call models, spawn agents, run processes, trigger escalation, apply edits, or block completion automatically.

Use `stardock_policy({ action: "completion" })` before claiming substantial work complete when you want a read-only readiness check. It inspects criteria, artifacts, final reports, auditor reviews, and breakout packages and returns advisory findings with linked evidence plus suggested tools such as `stardock_final_report`, `stardock_auditor`, or `stardock_breakout`. Blocked or skipped criteria can be accepted as deferred work only when a resolved/dismissed breakout package explains the decision and passed final-report or auditor evidence covers the deferred criterion; policy then returns `ready: true` with status `ready_with_accepted_gaps`. Policy findings do not mutate state, call models, spawn agents, run processes, apply edits, or hard-block completion; agents remain responsible for judgment and validation.

Use `stardock_policy({ action: "auditor" })` when deciding whether oversight should inspect a high-risk governance point. It recommends `stardock_auditor` for failed/blocked/skipped criteria, final-report gaps or non-passing validation, WorkerReports with risks/open questions/review hints/non-passing validation, implementer handoffs, and open breakout packages. The auditor policy only explains triggers and linked evidence; it does not create auditor reviews, spawn reviewers, call models, run tools, enforce gates, or replace a user/governor decision.

Use `stardock_policy({ action: "parentReview" })` before relying on WorkerReports or advisory handoffs. It recommends selective parent/governor review for worker risks, open questions, review hints, failed or skipped validation, changed-file reports, and implementer handoffs. The policy is a routing aid: inspect files for risk, ambiguity, failed validation, public-contract changes, or explicit review hints; do not blindly reread every touched file or blindly accept provider output.

Use `stardock_policy({ action: "auditorGate" })` before high-risk automation or completion moves. It flags blocking auditor follow-ups, implementer handoffs, open breakout packages, unresolved criteria, and evolve execution as gate points that require compliance, explicit rejection with rationale, or user escalation. The policy is read-only and advisory; it does not enforce gates or run providers.

Use `stardock_policy({ action: "breakout" })` when deciding whether a stuck loop should package a decision rather than keep iterating vaguely. It recommends `stardock_breakout` for failed/blocked criteria, repeated blocked/invalid/worse recursive attempts, pending criteria with no verification artifacts after multiple iterations, skipped evidence or final-report gaps, unresolved outside requests, blocking auditor follow-ups, and existing open breakout packages that should be updated or resolved. The breakout policy only explains triggers and linked evidence; it does not create breakout packages, stop loops, call models, run tools, enforce gates, or replace a user/governor decision.

Use `followupTool` on mutating Stardock tools when you want immediate read-only context without bespoke `include*` flags. The followup runs through Stardock's local read-only followup registry, not arbitrary Pi tools. V1 supports `stardock_state`, `stardock_policy`, and read-only `list` actions for local Stardock evidence tools such as `stardock_brief`, `stardock_ledger`, `stardock_final_report`, `stardock_auditor`, `stardock_breakout`, `stardock_handoff`, and `stardock_worker_report`; mutating or unknown actions are rejected and reported in `details.followupTool` instead of being executed. Use `attachAs: "details"` for machine-readable context, `"content"` for visible appended text, or `"both"` when supported by the calling tool. Existing `includeState`, `includeOverview`, and `includePromptPreview` flags remain compatibility sugar while new workflows should prefer `followupTool` for richer post-action context.

Use `stardock_worker_report` when a human, agent, model, CLI, or future adapter returns work that should guide selective parent/governor review. `payload` builds a provider-neutral WorkerReport contract; `record` stores compact results with status `draft`, `submitted`, `accepted`, `needs_review`, or `dismissed`, plus role, objective, summary, related advisory handoffs, evaluated criteria, artifacts, changed files, validation records, risks, open questions, suggested next move, and review hints; pass `reports: [...]` for batch writes or single-report fields for one-item batches. `list` inspects recorded reports. Worker reports are evidence records, not execution: Stardock does not run providers, assume output formats, apply patches, or force parent review automation in v1.

Use `stardock_advisory_adapter({ action: "payload", role: "explorer" | "test_runner" })` when the parent wants a ready-to-run `pi-subagents` invocation for the active or selected brief. The adapter output is convenience text plus structured invocation details only: Stardock still does not execute providers, spawn agents, persist provider-specific state, or apply edits. Explorer payloads default to the `scout` subagent and ask for a read-next map; test-runner payloads default to `delegate` and ask for bounded validation evidence. The parent remains responsible for invoking the worker, inspecting the result, recording compact findings, and running `stardock_policy({ action: "parentReview" })` when risk warrants.

Stardock also derives a read-only workflow status from existing facts such as worker reports, auditor reviews, breakout packages, criteria, and final reports. The status is exposed in `stardock_state` details, list summaries, overviews, prompts, and the active widget; it is not stored as mutable truth. Current states include `ready_for_work`, `active_work`, `needs_parent_review`, `needs_auditor_review`, `needs_breakout_decision`, `ready_for_final_verification`, `ready_to_complete`, `blocked`, and `completed`. Active-loop UI notifications fire only on meaningful actionable status transitions, not every refresh. Prompt gate notes tell agents to address or explicitly reject parent-review, auditor, breakout, blocked, or final-verification states before continuing implementation. In checklist mode, `stardock_done` does not queue another implementation prompt when the derived workflow state is gated or ready to complete; it returns the status so the parent can resolve the gate or finish. Use the recommended actions as routing hints, then record real decisions/evidence with the underlying tools.

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

### `evolve`

Metric-driven candidate search remains reserved. Stardock defines the future candidate/archive/evaluator state shape so migrated local state can be inspected safely, but `stardock_start` and `/stardock start --mode evolve` still refuse to create an evolve run. Entering evolve execution requires evidence from recursive dogfooding plus explicit decisions for evaluator contracts, time/output bounds, archive and prompt caps, candidate isolation, criteria/evidence handling, artifact storage, and auditor or user approval gates. Future candidate outputs should store large patches and evaluator logs as artifacts referenced by path rather than in loop state.

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
