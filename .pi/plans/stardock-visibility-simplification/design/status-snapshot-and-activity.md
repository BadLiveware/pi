# Stardock Status Snapshot and Worker Activity

## Purpose

Define one ownership-safe status model whose primary output is an automatically maintained persistent widget, with footer/tool-row summaries and user-invoked dashboard commands providing progressively deeper context without turning live transport progress into durable loop state.

## Decision

Adopt two inputs and one pure selector:

1. **Durable input:** the current `LoopState`, including active brief, workflow status, WorkerRuns, WorkerReports, governor routing, and completion/review gates.
2. **Ephemeral input:** a runtime-owned `WorkerActivityRegistry` keyed by loop, stage/node, and request/run identity, supporting multiple attached Treehouse workers.
3. **Selector:** `selectStardockStatusSnapshot(state, activity, now)` returns an unstyled, bounded snapshot. Renderers choose their own projection and width.

No high-frequency worker progress is persisted. No durable WorkerRun is automatically terminalized merely because the current Pi session cannot see local activity.

## Visibility hierarchy

1. **Primary — passive persistent widget:** Stardock calls `ctx.ui.setWidget("stardock", lines)` automatically whenever an active loop is started/restored and refreshes it from lifecycle/activity events. Useful loop, stage, worker, review/failure, and next-action state must be visible without a command, tool call, expansion, dashboard, or footer configuration.
2. **Supplemental passive context:** extension status/footer and live worker/stage tool rows provide compact context where Pi already renders them. They may disappear under custom footer layouts or outside a tool invocation, so they cannot carry the only copy of critical state.
3. **Deeper user-invoked inspection:** `/stardock dashboard`, state/list tools, and expanded tool rows expose bounded run ids, paths, evidence, and integration details. They elaborate the widget; they are not the route to basic awareness.
4. **Transient attention:** notifications announce important transitions but do not replace the persistent widget.

The widget registers and updates as part of normal Stardock runtime wiring. Footer Framework configuration is optional personalization only and is never a prerequisite for passive Stardock visibility.

## Data shape

The exact TypeScript naming may change during implementation, but the contract must retain these semantics:

```ts
interface WorkerActivity {
  loopName: string;
  workerRunId: string;
  requestId: string;
  role: AdvisoryHandoffRole;
  stageId?: string;
  nodeId?: string;
  briefId?: string;
  outsideRequestId?: string;
  currentTool?: string;
  toolCount?: number;
  phase: "starting" | "running" | "finishing";
  startedAt: string;
  lastUpdatedAt: string;
}

interface StardockStatusSnapshot {
  loop: {
    name: string;
    mode: LoopMode;
    iteration: number;
    maxIterations: number;
    workflowState: string;
    workflowSeverity: "info" | "warning" | "blocked";
  };
  brief?: {
    id: string;
    objective: string;
    task: string;
  };
  stage?: {
    id: string;
    status: string;
    total: number;
    ready: number;
    running: number;
    needsReview: number;
    failed: number;
    awaitingIntegration: number;
    integrationPrepared: boolean;
  };
  primaryWorker?: AttachedWorkerStatus;
  attachedWorkers: AttachedWorkerStatus[];
  reviewNeeded: Array<{ runId: string; stageId?: string; nodeId?: string; role: AdvisoryHandoffRole; briefId?: string }>;
  nextAction?: { label: string; tool?: string; args?: Record<string, unknown> };
}
```

Collections in the snapshot are capped. Full WorkerRun/WorkerReport history remains available through paginated tools. Renderers may label an implementation node as a “lane,” but durable joins use the globally unique `nodeId`.

## Ownership

| Concern | Owner |
| --- | --- |
| WorkerRun lifecycle and persisted evidence | `stardock-worker-tool` / worker-run state slice |
| Transport start/update/response events | pi-subagents bridge |
| In-memory activity records and cleanup | status/activity slice owned by the Stardock runtime instance |
| Snapshot selection and attached/detached interpretation | pure status selector |
| Footer/widget/dashboard/tool-card styling and width | individual UI renderers |
| Persisted-state hard cutover/restart | schema-v4 cutover slice |

The registry must never be module-global across unrelated runtime instances. A companion runtime controller registry owns one AbortController/cancel handle and one completion watchdog per active bridge request. Session shutdown cancels and settles every owned bridge run before clearing local activity and timers.

## Invariants

- At most one current-workspace mutable implementer is open. Multiple mutable implementers are allowed only as validated lanes in one recorded Treehouse stage with unique worktrees and disjoint write ownership.
- Activity updates are accepted only when loop, stage/node when present, request id, and run id match the registered activity.
- A bridge response removes local activity only after the durable WorkerRun transition has been saved or the failure path has recorded its terminal result.
- Missing local activity does not prove a durable `running` run is orphaned; the display state becomes `detached`.
- Stage aggregate, durable prepared/finalization state, and review-needed state outrank recently completed informational workers.
- The primary worker is selected deterministically from attached lanes; the snapshot retains a bounded attached-worker list rather than collapsing parallel work to one worker.
- Snapshot selection does not read worker output files or serialize full summaries.
- Current tool and tool count are observational. Their absence does not make a run failed.

## Refresh behavior

- On extension/session initialization, resolve the active/recoverable loop and render the widget immediately before any user-invoked status path.
- Refresh immediately on loop/brief changes, worker registration, bridge start/update/response, WorkerRun review, failure/detachment, stage/fan-in transitions, loop switch, pause, completion, and session shutdown.
- Bound a started bridge run with a two-hour completion watchdog. Tests inject a short duration. Timeout follows the same cancel/finish/unsubscribe path as user/session cancellation and records an explicit failed outcome.
- Coalesce repeated bridge updates into at most one render request per short interval. A 100–250 ms coalescing window is sufficient for tool bursts.
- While a widget represents an active or recoverable loop, run one low-frequency durable-state revision/mtime watcher (for example every 2 seconds) so another Pi runtime's review/failure/fan-in update becomes visible without user action. It reads only the selected state header/snapshot inputs, not full histories.
- A separate 5-second elapsed-time tick may run only while locally attached activity exists; elapsed time is not a stopwatch contract.
- Dispose both timers/watchers on session shutdown or when no active/recoverable loop or retained terminal snapshot remains.

## Surface projections

### Footer/status — supplemental passive summary

One line, highest-priority fact only:

```text
sd traffic 12/30 · run372 impl/bash 1m38s
sd traffic · stage status · 4 workers · 1 review
sd traffic · stage failed · lane snapshot
sd traffic · ready-to-complete
```

The extension publishes this through `ctx.ui.setStatus("stardock", ...)`. Default Pi footers can display it. Footer Framework users can optionally add an `extensionStatus` adapter for key `stardock`; Stardock does not rewrite their config, and the widget remains fully useful when extension status is hidden.

### Persistent widget — primary passive surface

Four to six lines:

```text
Stardock · traffic · stage status-impl · 4/5 running
A activity · bash · 8 tools
B snapshot · test · 3 tools
C worker-card · needs review
Next: review C; fan-in waits for A/B/D/E
```

Show governor/outside/reflection information only when it is the active blocker or no worker fact is more important. Do not retain the existing accumulation of every secondary status line.

The runtime installs this widget automatically on loop start/session restore and updates it on local events or durable revision changes. Pausing a nonterminal loop retains a recoverable widget with resume/reconcile next action. Completion retains the final snapshot in memory for the rest of the session (until a new loop starts); a later session with no active/recoverable loop clears it. A user must not run a status/dashboard/state tool to discover progress, review need, failure, detachment, terminal outcome, or next action.

### Worker tool row — contextual detail during execution

- Call: role, stage/lane or brief/request, model/thinking when non-default.
- Partial: run id, lane, current phase/tool, tool count, elapsed, and bounded aggregate stage progress when the parent tool owns fan-out.
- Final collapsed: terminal/needs-review state, changed-file count, report id, output-ref count.
- Expanded: bounded changed paths, output refs, validation/review hint, and failure summary.

### Dashboard — deeper user-invoked inspection

`/stardock dashboard [loop]` keeps `/stardock status` list-all semantics intact. The dashboard reports:

- loop and workflow gate;
- active brief and parallel-stage dependency/fan-in state;
- bounded attached or detached worker lanes;
- all review-needed implementers within a bounded cap;
- bounded recent terminal workers/lanes;
- next recommended action with tool/arguments when available.

A text-backed custom component is sufficient initially. It may expose more evidence than the widget, but no basic active/review/failure/next-action fact may exist only here. Add selection/overlay interaction only when it materially improves inspection.

## Notification policy

Emit asynchronous worker notifications only for:

- worker started;
- worker failed or cancelled;
- worker completed successfully when no review is required;
- worker moved to `needs_review`;
- stage moved to `awaiting_integration`, `integrated`, or `failed`.

Deduplicate worker events by run id plus transition and stage events by stage id plus transition. Preserve command validation errors, loop lifecycle messages, auditor/breakout gates, and workflow transition notifications.

## Rejected alternatives

- **Persist every progress update:** rejected because it adds write amplification, state churn, and misleading durable transport detail.
- **Automatically mark all `running` runs interrupted on session start:** rejected because another Pi session may own the run.
- **One identical string for every surface:** rejected because footer, widget, tool row, and dashboard have different width and retrieval jobs.
- **Footer-only status:** rejected because custom footers may hide extension statuses and the footer cannot carry review context.
- **Dashboard/status-command as the primary status path:** rejected because visibility that requires user action does not provide continuous operational awareness.
- **Notifications as the primary status path:** rejected because transient messages cannot represent current state after the moment passes.
- **Full interactive dashboard first:** rejected because the automatic widget and shared snapshot provide more default value with less UI complexity.

## Future ownership enhancement

If detached-running ambiguity remains operationally painful, add an explicit worker lease with session identity and heartbeat in a separate architecture decision. Do not add PID-only orphan detection; PID reuse and remote/subagent transport make it insufficient.

## Execution relationship

- Implemented by [`../slices/01-worker-activity-and-status-snapshot.md`](../slices/01-worker-activity-and-status-snapshot.md).
- Projected by [`../slices/02-user-visible-worker-status.md`](../slices/02-user-visible-worker-status.md).
