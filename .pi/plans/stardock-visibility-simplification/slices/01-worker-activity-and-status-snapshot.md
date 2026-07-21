# 01: Freeze Worker-status Contracts

## Goal

Define and validate the shared worker activity, multi-worker snapshot, automatic persistent-widget contract, renderer input, notification event, and runtime dependency interfaces that all status implementations will consume in parallel worktrees.

## Scope

In scope:

- Shared status/stage contracts and passive-first visibility invariants.
- Test builders/fixtures for activity, snapshots, stages, lanes, WorkerRuns, and workflow actions.
- Compile-only seams/stubs for downstream lane modules.
- Exact lane ownership and Treehouse stage definition.

Out of scope:

- Activity registry, snapshot selection, renderers, notifications, dashboard, or wiring implementations.
- Persisted schema changes beyond consuming the additive stage state from Slices 00a–00e.

## Affected areas

- New `agent/extensions/private/stardock/src/status/contracts.ts`
- New shared status test builders under `agent/extensions/private/stardock/test/support/`
- Minimal runtime dependency interfaces needed by downstream modules
- No existing UI/worker/command implementation files

## Required references

- [`../design/status-snapshot-and-activity.md`](../design/status-snapshot-and-activity.md)
- [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)
- [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md)
- Validated Slices 00a–00e stage/tool/ownership/integration contract

## Tasks

1. Define unstyled `WorkerActivity`, `AttachedWorkerStatus`, `StardockStatusSnapshot`, `WorkerTransition`, renderer-input, and activity/controller interfaces. Snapshot contracts support aggregate stage counts, a primary worker, bounded attached/review/detached state, and next action.
2. Freeze the visibility hierarchy in contract tests: automatically maintained widget is primary; footer/tool rows/notifications are supplemental; dashboard/state/list/expanded views are deeper inspection only. Basic progress/review/failure/detached/next-action facts must exist in the widget projection.
3. Define selection priority and bound constants in the contract: attached running lanes, review-needed lanes, failed/cancelled, recent terminal; footer and widget receive projections but do not own selection policy.
4. Define activity lifecycle events for register/start/update/finishing/terminal/cancel/timeout and explicit stable identity fields (loop, stage, lane, run, request).
5. Add test builders for no-loop, serial worker, five-lane stage, detached lane, needs-review lane, failed lane, workflow blocker, integration-prepared/finalize action, and terminal fan-in states.
6. Add compile-only interfaces for activity registry, selector, renderer functions, notification tracker, dashboard formatter, and runtime refresh callback. Stub functions may throw only inside tests that verify interface shape; no production path calls them before fan-in.
7. Define the parallel stage lanes, file ownership, and resource claims (unique fixture directories/ports/cache keys or explicit serialization):
   - `status-activity`: activity/controller/bridge orchestration modules and bridge tests.
   - `status-selector`: pure snapshot selector and selector tests.
   - `status-worker-card`: worker tool renderer module and renderer tests.
   - `status-footer-widget`: footer/widget pure renderer modules and width tests.
   - `status-dashboard-notifications`: dashboard/transition modules and tests.
   Existing wiring files (`index.ts`, `stardock-worker-tool.ts`, `runtime/ui.ts`, `runtime/commands.ts`, workflow notification wiring) are fan-in-owned and forbidden to lane workers.
8. Run contract/type tests and commit the frozen contract. Record the exact commit as the Treehouse stage `contractCommit`.
9. Create one Stardock brief per lane with exact ownership/resources/validation and the contract-change stop rule; upsert the stage DAG with canonical brief/stage contract digests and verify all five lanes are ready.

## Acceptance criteria

- [ ] All five lane implementations can compile against one frozen contract without editing shared contract or wiring files.
- [ ] Snapshot/widget contract models multiple attached workers and aggregate stage state, not a single-worker assumption.
- [ ] Contract tests reject any projection where ordinary progress, review/failure/detached state, or next action is available only through a user-invoked surface.
- [ ] Lane write ownership is disjoint and validated by `stardock_stage`.
- [ ] Contract fixtures cover attached, detached, review-needed, failed, and fan-in states.
- [ ] Contract commit passes typecheck/tests and is recorded before any Treehouse lease is acquired.
- [ ] A lane needing contract changes must stop and return a contract-change request.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/status-contracts.test.ts \
  private/stardock/test/stages.test.ts
```

Expected signal: contract/test builders compile and pass; `stardock_stage list` reports five ready, non-overlapping lanes at one contract SHA.

## Risks and split triggers

- Do not let contract work become an implementation parking lot. Once interfaces and fixtures compile, start the five lanes in the same execution path.
- A contract defect discovered after fan-out requires a new validated contract commit and restart of affected lanes; lanes do not amend the contract locally.
