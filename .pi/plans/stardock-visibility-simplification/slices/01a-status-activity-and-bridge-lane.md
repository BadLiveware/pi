# 01a: Status Activity and Bridge Lane

## Goal

Implement runtime-local multi-worker activity, bridge cancellation/timeout controllers, and cleanup against the frozen status contracts.

## Dependencies

- Slices 00a–00e parallel foundation integrated and Slice 01 contract/stage committed.
- Slice 01 contract commit frozen.

## Treehouse lane

- Lane id: `status-activity`
- Writable areas: `src/status/activity.ts`, `src/status/controllers.ts`, `test/worker-activity.test.ts`, `test/worker-bridge-lifecycle.test.ts`.
- Forbidden: shared contracts, `index.ts`, `stardock-worker-tool.ts`, runtime UI/commands, renderer/dashboard modules.

## Tasks

1. Implement a runtime-instance registry keyed by loop/stage/lane/run/request with stale-id rejection and bounded attached activity reads.
2. Implement runtime-owned AbortController/cancel registry and the two-hour injectable completion watchdog.
3. Implement activity/controller observer adapters consumed by the existing bridge/worker seams during Slice 02 fan-in; every start/update/finishing/response/cancel/timeout event requests a bounded passive UI refresh and cleans exactly once without editing bridge source in this lane.
4. Support multiple simultaneous Treehouse lane bridge runs while preserving serial current-workspace behavior through the foundation's worker policy.
5. Add fake-clock, started-without-response, shutdown, response-after-cancel, update-after-response, two-runtime, and five-concurrent-lane tests.
6. Commit all changes, finish clean, and report base/head SHA, changed paths, validation, and any contract-change request.

## Acceptance criteria

- [ ] Five concurrent lane activities remain isolated and update in O(1).
- [ ] No controller, subscription, watchdog, or activity survives terminal/cancel/timeout/shutdown.
- [ ] Activity transitions emit passive refresh signals without requiring status polling or durable progress writes.
- [ ] Changed paths stay inside lane ownership and the worktree is clean/committed.

## Validation

```bash
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/worker-activity.test.ts \
  private/stardock/test/worker-bridge-lifecycle.test.ts \
  private/stardock/test/brief-worker-runs.test.ts
```

Expected signal: all lifecycle/race/concurrency tests pass in the lane worktree.
