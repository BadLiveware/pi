# Stardock Worker Visibility and Simplification Checklist

Use this file only as the bounded Stardock runtime wrapper. Detailed scope, compatibility gates, and validation live in the linked execution files.

## Goals

- Make active worker state and next action continuously visible in an automatically maintained widget, without requiring user action.
- Keep commands, state tools, expanded rows, and dashboard as deeper inspection paths rather than the primary visibility mechanism.
- Gate public API removals on replacement evidence; delete pre-change run-state compatibility without migration.
- Reduce globally active tool metadata without hiding workflow capabilities.
- Keep each execution item independently reviewable and revertible.

## Stardock execution rules

- Use one serial contract/fan-in brief for each contract or integration node and one brief per parallel implementation lane.
- Read the linked node/lane plus its required design/docs before creating briefs.
- Promote only the current node/lane acceptance criteria into `stardock_ledger`; stage-level integration criteria stay in the fan-in brief.
- Current-workspace implementers remain serial. Run parallel implementers only through a validated `stardock_stage` in distinct Treehouse leases, review every lane, and integrate in recorded order.
- Treat passive widget visibility as a release gate: do not accept a status implementation that requires `/stardock status`, `/stardock dashboard`, a state tool, row expansion, or Footer Framework configuration for ordinary awareness.
- Store command logs, inventories, TUI captures, and metadata measurements as external artifacts with compact ledger refs.
- Do not combine Slices 04–05 or 08–09; their public-contract and taxonomy checkpoints remain intentional.

## Checklist

- [ ] Complete [`slices/00-baseline-and-contract-fixtures.md`](slices/00-baseline-and-contract-fixtures.md): freeze reproducible evidence and compatibility fixtures.
- [ ] Complete serial bootstrap [`00a`](slices/00a-parallel-stage-and-treehouse-foundation.md): persist/validate the node-level DAG, ownership, and resources.
- [ ] Complete serial bootstrap [`00b`](slices/00b-treehouse-adapter-and-lease-lifecycle.md): add exact-SHA Treehouse adapter and one disposable lease smoke.
- [ ] Complete serial bootstrap [`00c`](slices/00c-stage-ownership-and-state-safety.md): add cross-process ownership token, guarded state updates, and detached/reconcile state.
- [ ] Complete serial bootstrap [`00d`](slices/00d-run-ready-concurrent-orchestration.md): add bounded `runReady`, pre-created WorkerRuns, and committed lane validation.
- [ ] Complete serial bootstrap [`00e`](slices/00e-fan-in-recovery-and-treehouse-dogfood.md): add integration/reconcile/retry/release and pass exact two-lane Treehouse dogfood.
- [ ] Complete [`slices/01-worker-activity-and-status-snapshot.md`](slices/01-worker-activity-and-status-snapshot.md): freeze multi-worker status contracts and record the five-lane stage.
- [ ] Run these five ready lanes concurrently from the same contract commit: [`01a`](slices/01a-status-activity-and-bridge-lane.md), [`01b`](slices/01b-status-snapshot-selector-lane.md), [`01c`](slices/01c-worker-tool-card-lane.md), [`01d`](slices/01d-footer-widget-lane.md), and [`01e`](slices/01e-dashboard-notifications-lane.md).
- [ ] Complete [`slices/02-user-visible-worker-status.md`](slices/02-user-visible-worker-status.md): review/no-ff-merge all five lanes on a dedicated integration branch, wire/commit shared files, validate, prepare, fast-forward, and finalize fan-in, and release clean leases.
- [ ] Complete [`slices/02a-cleanup-api-parallel-contract.md`](slices/02a-cleanup-api-parallel-contract.md): freeze exact Slice 03/04 briefs, ownership/resources, shared fan-in files, and contract/base SHA.
- [ ] Run [`slices/03-command-and-dead-code-cleanup.md`](slices/03-command-and-dead-code-cleanup.md) and [`slices/04-first-party-deprecation-migration.md`](slices/04-first-party-deprecation-migration.md) concurrently through that validated stage.
- [ ] Complete [`slices/04a-cleanup-api-fan-in.md`](slices/04a-cleanup-api-fan-in.md): integrate both lanes, update shared guidance/capabilities, and produce the Slice 05 decision package.
- [ ] Record explicit user go/no-go approval for the Slice 05 breaking removals after reviewing Slice 04 replacement and residual-risk evidence.
- [ ] Complete [`slices/05-remove-superseded-tools-and-flags.md`](slices/05-remove-superseded-tools-and-flags.md): delete compatibility tools and include flags after approval.
- [ ] Complete [`slices/06-schema-v4-derived-state-cleanup.md`](slices/06-schema-v4-derived-state-cleanup.md): finish/abandon stages, checkpoint durable plan evidence, hard-cut to schema v4, discard old run state, and start a fresh continuation loop.
- [ ] Complete [`slices/06a-state-retirement-parallel-contract.md`](slices/06a-state-retirement-parallel-contract.md): freeze exact Slice 07/08 removal briefs, isolated resources, shared fan-in files, and contract/base SHA.
- [ ] Run [`slices/07-retire-reserved-evolve-state.md`](slices/07-retire-reserved-evolve-state.md) and [`slices/08-retire-flat-state-layout.md`](slices/08-retire-flat-state-layout.md) concurrently through that validated stage.
- [ ] Complete [`slices/08a-state-retirement-fan-in.md`](slices/08a-state-retirement-fan-in.md): integrate both removal lanes, delete shared compatibility wiring/docs, validate fresh schema-v4 behavior, and release clean leases.
- [ ] Complete [`slices/09-dynamic-tool-loading.md`](slices/09-dynamic-tool-loading.md): activate a small discoverable core and load specialized tools safely.

## Final verification

- Run every slice's focused validation.
- Run the complete matrix in [`docs/validation.md`](docs/validation.md).
- Record an independent final auditor review.
- Confirm current README, skill, agent profiles, schemas, diagrams, and historical notices agree.
- Confirm live linked layout and worker-status dogfood before `stardock_complete`.
