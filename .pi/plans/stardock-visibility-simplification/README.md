# Stardock Worker Visibility and Simplification

> **Superseded:** This plan documents the previous low-level stage/worker design and is retained as historical evidence only. New bounded Stardock work follows [`../simplified-stardock/README.md`](../simplified-stardock/README.md) and the graph-first `plan → run → review → status` workflow, with optional integration plus recovery and completion actions.

## Purpose

Make Stardock's current work passively and continuously legible—especially live worker activity, review gates, failures, and next actions—while reserving user-invoked commands for deeper inspection and removing superseded APIs, speculative modes, duplicated state, and globally active tool metadata that no longer earn their complexity.

## Desired end state

- The automatically registered persistent widget is the primary visibility surface. It shows bounded loop/stage progress, workers, review/failure state, and next action on start, restore, and live updates without requiring a command, tool call, expansion, or user configuration.
- Footer/status and worker/stage rows add passive context where available; `/stardock dashboard`, state/list tools, and expanded rows provide deeper user-invoked inspection but are not required for basic awareness.
- Stardock can record a dependency DAG, freeze an interface/contract commit, execute ready non-overlapping implementation lanes concurrently in Treehouse leases, and fan reviewed commits into one validated integration stage.
- `/stardock dashboard [loop]` provides a bounded deeper-inspection view without changing `/stardock status` list-all semantics or replacing the always-on widget.
- Durable loop state and ephemeral worker activity have separate owners. Progress updates are not written to state on every subagent tool event.
- A persisted `running` WorkerRun without locally owned activity is displayed as detached/last-known rather than silently mutated or presented as certainly live.
- User notifications cover meaningful asynchronous worker transitions without suppressing normal command, lifecycle, or workflow-gate feedback.
- Dead helpers, ineffective pacing inputs, superseded wrappers/adapters, bespoke response-expansion flags, duplicate command implementations, reserved evolve state, and flat-layout loading are removed. Public API removals keep explicit gates; pre-change run-state compatibility does not.
- Specialized but still purposeful evidence capabilities remain available through discoverable dynamic tool loading instead of occupying every model request.
- README, skill, agent capability profiles, architecture diagrams, historical plans, schemas, migrations, and tests describe the same public surface.

## Scope

In scope:

- Contract-first execution DAGs, parallel stages, Treehouse lease lifecycle, lane ownership, and parent-controlled fan-in.
- Worker activity ownership and multi-worker status snapshot selection.
- Passive-by-default persistent widget lifecycle, supplemental footer/status and worker rows, transition notifications, and deeper dashboard behavior.
- Safe command and dead-code cleanup.
- Migration from `stardock_brief_worker` and `stardock_advisory_adapter` to `stardock_worker`.
- Migration from `includeState`, `includeOverview`, and `includePromptPreview` to `followupTool` or explicit read tools.
- Hard schema-v4 cutover removing `active` and `itemsPerIteration`; pre-change runs are unsupported and restarted rather than migrated.
- Direct deletion of reserved evolve state/types and flat `.stardock/*.state.json` lookup/import compatibility.
- Final tool taxonomy and dynamic activation/lazy loading.
- Tests, user documentation, agent-facing guidance, capability profiles, and linked live layout.

Out of scope:

- Concurrent mutable workers in the same checkout; concurrency is allowed only in validated, isolated Treehouse lanes.
- Background worker execution that survives Pi process exit.
- A distributed worker scheduler or cross-machine lease service.
- Replacing pi-subagents as the worker transport.
- Changing the semantics of workflow gates, ledger evidence, auditor review, final verification, or breakout decisions except where tool discovery must expose the existing capability.
- Automatically editing the user's Footer Framework configuration without explicit approval. The extension will publish a useful `stardock` extension status and document the adapter recipe.
- Deleting low-frequency tools solely because they are uncommon; workflow-specific capabilities are removed only when superseded or proven purposeless.
- Preserving, migrating, or supporting mixed-version access to pre-change active/paused/completed/archived Stardock runs.

## Observed facts

- `agent/extensions/private/stardock/src/runtime/ui.ts` already calls `ctx.ui.setWidget("stardock", ...)` automatically for an active loop, but the widget emphasizes loop/governor/reflection context and has no active WorkerRun or parallel-stage detail. The implementation must preserve this zero-action delivery while replacing its content model.
- `agent/extensions/private/stardock/src/brief-worker-run-bridge.ts` already receives `currentTool` and `toolCount` updates.
- `stardock_worker` forwards those updates to the generic tool row but has no custom partial/final renderer.
- `formatRunOverview()` reports worker counts; `formatRunTimeline()` reports completed/durable WorkerRun entries but neither is a live worker dashboard.
- The current Footer Framework configuration hides generic extension status and has no Stardock adapter.
- Stardock currently registers 21 tools with approximately 63,687 bytes of description/schema/prompt metadata in the test harness.
- Local session-log evidence strongly favors `stardock_worker`, `stardock_ledger`, `stardock_brief`, `stardock_state`, policy/auditor/final-report flows, and shows no observed `stardock_brief_worker` or `stardock_advisory_adapter` calls.
- A `/home/fl/code` inventory found 25 nested state files, zero flat state files, zero evolve states, and zero archived states. This is implementation context only; those runs are not migration or acceptance inputs.

See [`docs/evidence-baseline.md`](docs/evidence-baseline.md) for reproducible measurements and [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) for public-surface removal gates and the explicit new-state-only policy.

## Directory layout

| Area | Purpose |
| --- | --- |
| [`stardock-checklist.md`](stardock-checklist.md) | Thin bounded-execution wrapper for Stardock. |
| [`slices/`](slices/) | Ordered, independently reviewable implementation spine. |
| [`docs/evidence-baseline.md`](docs/evidence-baseline.md) | Current measurements and inventory commands. |
| [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) | Public-surface gates plus the unsupported old-run/mixed-version policy. |
| [`docs/validation.md`](docs/validation.md) | Shared deterministic, prompt-behavior, TUI, parallel-stage, and live-layout validation. |
| [`docs/treehouse-runbook.md`](docs/treehouse-runbook.md) | Exact lease, branch, lane review, fan-in, and release procedure. |
| [`design/parallel-stages-and-treehouse.md`](design/parallel-stages-and-treehouse.md) | Accepted DAG, lane ownership, orchestration, and integration design. |
| [`design/status-snapshot-and-activity.md`](design/status-snapshot-and-activity.md) | Accepted multi-worker status data/ownership design. |
| [`design/tool-taxonomy-and-loading.md`](design/tool-taxonomy-and-loading.md) | Accepted core/specialized tool taxonomy and discovery contract. |

## Read first

1. [`docs/evidence-baseline.md`](docs/evidence-baseline.md)
2. [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md)
3. [`design/parallel-stages-and-treehouse.md`](design/parallel-stages-and-treehouse.md)
4. [`docs/treehouse-runbook.md`](docs/treehouse-runbook.md)
5. [`design/status-snapshot-and-activity.md`](design/status-snapshot-and-activity.md)
6. [`docs/validation.md`](docs/validation.md)

Read [`design/tool-taxonomy-and-loading.md`](design/tool-taxonomy-and-loading.md) before executing Slice 09.

## Execution spine

| Order | File | Reviewable outcome |
| ---: | --- | --- |
| 00 | [`slices/00-baseline-and-contract-fixtures.md`](slices/00-baseline-and-contract-fixtures.md) | Freeze reproducible status, compatibility, state, and tool-metadata evidence before behavior changes. |
| 00a | [`slices/00a-parallel-stage-and-treehouse-foundation.md`](slices/00a-parallel-stage-and-treehouse-foundation.md) | Add persisted node-level DAG/stage/resource contracts and pure validation. |
| 00b | [`slices/00b-treehouse-adapter-and-lease-lifecycle.md`](slices/00b-treehouse-adapter-and-lease-lifecycle.md) | Add exact-SHA Treehouse lease/branch/status/return adapter and disposable lease smoke. |
| 00c | [`slices/00c-stage-ownership-and-state-safety.md`](slices/00c-stage-ownership-and-state-safety.md) | Add cross-process stage ownership, mutation token, guarded updates, and detached/reconcile state. |
| 00d | [`slices/00d-run-ready-concurrent-orchestration.md`](slices/00d-run-ready-concurrent-orchestration.md) | Add bounded Treehouse `runReady`, pre-created WorkerRuns, and clean committed lane validation. |
| 00e | [`slices/00e-fan-in-recovery-and-treehouse-dogfood.md`](slices/00e-fan-in-recovery-and-treehouse-dogfood.md) | Add dedicated integration branches, ancestry-verified fan-in, reconcile/retry/release, and real dogfood. |
| 01 | [`slices/01-worker-activity-and-status-snapshot.md`](slices/01-worker-activity-and-status-snapshot.md) | Freeze shared multi-worker activity/snapshot/rendering contracts and the five-lane stage. |
| 01a–01e | [activity](slices/01a-status-activity-and-bridge-lane.md), [selector](slices/01b-status-snapshot-selector-lane.md), [worker card](slices/01c-worker-tool-card-lane.md), [passive widget/footer](slices/01d-footer-widget-lane.md), [dashboard/notifications](slices/01e-dashboard-notifications-lane.md) | Execute five disjoint implementations concurrently from the frozen contract commit. |
| 02 | [`slices/02-user-visible-worker-status.md`](slices/02-user-visible-worker-status.md) | Review/no-ff-merge the five lanes on a dedicated integration branch, wire and commit shared runtime files, validate/prepare fan-in, fast-forward, and finalize. |
| 02a | [`slices/02a-cleanup-api-parallel-contract.md`](slices/02a-cleanup-api-parallel-contract.md) | Freeze exact cleanup/API briefs, ownership/resources, shared fan-in files, and contract/base SHA. |
| 03 ∥ 04 | [`slices/03-command-and-dead-code-cleanup.md`](slices/03-command-and-dead-code-cleanup.md) and [`slices/04-first-party-deprecation-migration.md`](slices/04-first-party-deprecation-migration.md) | Run code/test work in parallel Treehouse lanes with disjoint ownership. |
| 04a | [`slices/04a-cleanup-api-fan-in.md`](slices/04a-cleanup-api-fan-in.md) | Integrate both lanes, update parent-owned shared docs/capabilities, validate, and produce the removal decision package. |
| 05 | [`slices/05-remove-superseded-tools-and-flags.md`](slices/05-remove-superseded-tools-and-flags.md) | Remove the worker wrapper, advisory adapter, and obsolete include flags after the replacement contract is proven. |
| 06 | [`slices/06-schema-v4-derived-state-cleanup.md`](slices/06-schema-v4-derived-state-cleanup.md) | Hard-cut to schema v4, reject/discard old runs, remove derived/pacing fields, and start a fresh continuation loop. |
| 06a | [`slices/06a-state-retirement-parallel-contract.md`](slices/06a-state-retirement-parallel-contract.md) | Freeze disjoint evolve/flat removal briefs, resources, shared fan-in files, and contract/base SHA. |
| 07 ∥ 08 | [`slices/07-retire-reserved-evolve-state.md`](slices/07-retire-reserved-evolve-state.md) and [`slices/08-retire-flat-state-layout.md`](slices/08-retire-flat-state-layout.md) | Directly remove evolve and flat-layout compatibility in parallel. |
| 08a | [`slices/08a-state-retirement-fan-in.md`](slices/08a-state-retirement-fan-in.md) | Integrate removal lanes, delete shared compatibility wiring/docs, validate fresh schema-v4 behavior, and freeze surviving taxonomy. |
| 09 | [`slices/09-dynamic-tool-loading.md`](slices/09-dynamic-tool-loading.md) | Keep a small discoverable core active and lazily expose specialized tools without breaking policy/followup workflows. |

## Dependency graph

```text
00 -> 00a graph -> 00b adapter -> 00c ownership -> 00d runReady -> 00e fan-in/recovery dogfood
  -> 01 status contract
       -> {01a activity, 01b selector, 01c worker card, 01d passive widget/footer, 01e dashboard/notifications}
       -> 02 status fan-in
       -> 02a cleanup/API contract -> {03 command cleanup, 04 API migration} -> 04a fan-in
       -> approval -> 05 removals -> 06 hard schema-v4 cutover/restart
       -> 06a state-retirement contract -> {07 evolve deletion, 08 flat deletion}
            -> 08a fan-in -> 09 dynamic loading
```

Braced nodes run concurrently only after their explicit contract node commits exact briefs, ownership/resource claims, and base SHA. Slices 00a–00e bootstrap the capability serially. Slices 01a–01e are the primary divide-and-conquer wave; Slices 03/04 and 07/08 have their own contract and fan-in nodes. Slice 09 starts only after all fan-ins.

## Global constraints

- Keep `LoopState`/ExecutionGraph as durable parent-owned lifecycle truth and runtime `WorkerActivity` as non-durable observation only.
- Build and validate a DAG before fan-out. Parallel lanes require satisfied dependencies, one frozen contract SHA, disjoint write ownership, isolated validation resources, unique Treehouse leases, and one parent-owned fan-in.
- Treehouse lane workers commit clean changes but never integrate themselves. The parent no-ff merges accepted branches on a dedicated integration branch, commits fan-in work, validates a clean head, durably prepares ancestry/mappings before parent movement, fast-forwards the unchanged parent, finalizes idempotently, then releases leases.
- Hold a cross-process stage lock/mutation token during `runReady`; non-owner mutations fail visibly, read-only status remains available, and stale locks require reconciliation rather than automatic deletion.
- Key local activity by loop plus request/run identity; do not infer ownership from a `running` string alone.
- Never rewrite another Pi session's WorkerRun based only on missing local activity.
- Keep one unstyled canonical snapshot; the automatic widget owns the primary passive projection, while footer, tool row, notifications, and dashboard own supplemental/deeper bounded projections.
- Never make ordinary loop/stage progress, review need, failure, detachment, or next action discoverable only through a command, explicit tool call, expansion, notification, or Footer Framework configuration.
- Status refresh work scales with one active loop and at most the bounded recent/open worker set. Do not scan full worker/report history on every activity update.
- Use local events plus one low-frequency selected-state revision watcher while a widget represents an active/recoverable loop; use a separate elapsed-time tick only for locally owned activity. Clean both on shutdown or when no displayable loop remains.
- Preserve `/stardock status` as list-all. Add `/stardock dashboard [loop]` for the active-loop operator view.
- Scope notification deduplication to asynchronous worker transitions. Preserve command errors, loop lifecycle feedback, and actionable workflow-gate notifications.
- Use compatibility gates only for public tool/parameter contracts such as Slice 05. Pre-change run-state/schema/evolve/flat compatibility is explicitly unsupported and requires no migration inventory or approval gate.
- Update `agent/agents/`, global skills, Stardock skill/README, schemas, tests, and historical design references when tool capability changes.
- Keep `index.ts` registration-only. New status behavior belongs in a status/workflow vertical slice.
- Do not make dynamic loading the first cleanup. Stabilize names and replacements before changing activation behavior.
- Do not auto-edit `~/.pi/agent/footer-framework.config.ts`; a personal Stardock adapter is optional customization and must never gate the default widget.

## Performance shape

- Live activity events scale with worker tool executions and active Treehouse lanes. Bound stage concurrency (default at most five for the primary status wave), update each in-memory activity in O(1), and coalesce renders rather than writing state or rebuilding histories.
- Snapshot selection scans only current/open workers and a bounded recent tail. It must not serialize all WorkerReports, artifacts, or ledger entries.
- Tool metadata currently costs roughly 63.7 KB before conversation content. Slice 09 records the final always-active byte count and requires a material reduction without making specialized capabilities undiscoverable.
- Dashboard/history views remain paginated or bounded; live surfaces show one active worker plus a bounded recent/review-needed set.

## Rollback strategy

- Each slice is a separate review/commit boundary.
- Slices 00a–00c roll back independently before worker fan-out. After stage state exists, downgrade to an older Stardock writer is unsupported; first finish/abandon stages and return leases, then discard state and restart.
- Slices 01–02 can roll back on the dedicated integration branch before parent fast-forward; after integration, revert the stage merge/fast-forward result while preserving lane/integration refs and evidence.
- Slices 04–05 retain a compatibility checkpoint between first-party migration and public removal.
- Slice 06 is a hard cutover. Rollback restores code only; run state created across the cutover is discarded and restarted from the durable plan/checklist.
- Slices 07–08 can roll back source commits, but no evolve/flat run-state migration or reader restoration is required.
- Slice 09 can roll back to all-tools-active without reverting the final tool taxonomy.

## Final acceptance criteria

- [ ] A contract-first stage can execute at least two independent implementation lanes concurrently in Treehouse leases, preserve lane commits/evidence, and fan them into one reviewed, ancestry-preserving, validated integration head.
- [ ] Without any status command, dashboard, state-tool call, row expansion, or footer configuration, the automatically installed widget exposes useful serial/parallel progress, review/failure/detached state, and next action from loop start/session restore through terminal transition.
- [ ] Supplemental footer/status, worker/stage rows, notifications, and user-invoked dashboard collectively add bounded run/lane/role/scope/tool/evidence detail without becoming prerequisites for basic awareness.
- [ ] Worker completion, failure/cancellation, and `needs_review` transitions are visible and deduplicated; ordinary command and workflow notifications still work.
- [ ] `/stardock dashboard [loop]` reports active brief, active/detached worker state, review-needed workers, workflow gate, and next action without dumping history.
- [ ] A durable `running` run with no local activity is presented as detached/last-known and is not automatically mutated.
- [ ] Dead helper exports, ineffective pacing input, duplicate command implementation, superseded wrapper/adapter, and obsolete include flags are absent from production code and first-party guidance.
- [ ] Only fresh schema-v4 state is accepted; it contains neither `active` nor `itemsPerIteration`, and pre-v4/mixed-version state is rejected without migration.
- [ ] Reserved evolve types and flat state lookup/import/delete compatibility are absent from production code.
- [ ] The implementation loop restarts from durable plan/artifact context after cutover rather than migrated `.stardock` state.
- [ ] The final active tool set is discoverable, policy-compatible, followup-compatible, and materially smaller than the 63,687-byte baseline.
- [ ] Focused Stardock tests, extension typecheck, full extension tests, prompt-behavior scenarios, structure guard, diff check, live TUI dogfood, and linked-layout verification pass with fresh evidence.
