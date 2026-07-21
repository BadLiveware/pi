# 01b: Status Snapshot Selector Lane

## Goal

Implement the pure bounded multi-worker Stardock status selector against the frozen contracts.

## Dependencies

- Slices 00a–00e parallel foundation integrated and Slice 01 contract/stage committed.
- Slice 01 contract commit frozen.

## Treehouse lane

- Lane id: `status-selector`
- Writable areas: `src/status/snapshot.ts`, `test/worker-status-selector.test.ts`.
- Forbidden: shared contracts, bridge/activity modules, existing runtime wiring/UI/commands, renderers, dashboard, notifications.

## Tasks

1. Select stage aggregate counts, primary attached worker, bounded attached list, review-needed list, detached durable runs, recent failure/terminal state, active brief, workflow gate, and next action from LoopState plus activity input.
2. Enforce priority and cap constants from the contract without scanning or serializing full WorkerReport/artifact history.
3. Treat durable running lanes without matching local activity as detached and never mutate input state.
4. Add fake-clock tests for no-loop, serial, five-lane running, mixed tools, review priority, failed lane, detached lane, fan-in wait, bounds, and stable deterministic ordering.
5. Add a scale fixture with hundreds of historical runs/reports and assert bounded snapshot shape and no full-summary leakage.
6. Commit cleanly and report base/head SHA, paths, validation, and contract issues.

## Acceptance criteria

- [ ] Selection is pure, deterministic, bounded, and multi-worker aware.
- [ ] Attached/review/failed/detached priorities match the frozen contract.
- [ ] Historical scale does not enlarge snapshot collections or serialize long evidence.
- [ ] Changed paths stay inside lane ownership and the worktree is clean/committed.

## Validation

```bash
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/worker-status-selector.test.ts \
  private/stardock/test/views.test.ts
```

Expected signal: selector and unchanged view tests pass in the lane worktree.
