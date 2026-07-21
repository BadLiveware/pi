# 01e: Dashboard and Notifications Lane

## Goal

Implement bounded user-invoked deep-inspection dashboard formatting and deduplicated transition notifications that supplement, but never replace, the passive widget.

## Dependencies

- Slices 00a–00e parallel foundation integrated and Slice 01 contract/stage committed.
- Slice 01 contract commit frozen.

## Treehouse lane

- Lane id: `status-dashboard-notifications`
- Writable areas: `src/status/dashboard.ts`, `src/status/notifications.ts`, `test/worker-dashboard-notifications.test.ts`.
- Forbidden: shared contracts, `runtime/commands.ts`, workflow notification wiring, activity/snapshot/renderers.

## Tasks

1. Implement bounded dashboard formatting for deeper loop/workflow, stage dependency, attached/detached lane, review, recent terminal, evidence-ref, and next-integration inspection.
2. Keep `/stardock status` semantics out of this module; dashboard accepts a selected-loop snapshot only. Do not move basic progress/review/failure/next-action facts out of the widget contract.
3. Implement a tracker keyed by stage/lane/run plus transition and emit candidates only for start, failure/cancellation/timeout, successful no-review completion, needs-review, stage-awaiting-integration, and stage-integrated.
4. Ensure worker notification candidates remain independent from command errors, loop lifecycle, and existing workflow-gate notifications.
5. Add tests for duplicate updates, out-of-order lane completion, five workers, detached resume, review/failure, fan-in wait, bounded history, and tracker reset on session change.
6. Commit cleanly and report base/head SHA, paths, validation, and contract issues.

## Acceptance criteria

- [ ] Dashboard exposes deeper bounded stage/evidence state without dumping history or becoming necessary for ordinary awareness.
- [ ] Notifications deduplicate per transition and include stage fan-in milestones, while widget state remains the persistent source after transient messages disappear.
- [ ] Existing workflow/command notifications are not represented or suppressed by this tracker.
- [ ] Changed paths stay inside lane ownership and the worktree is clean/committed.

## Validation

```bash
cd agent/extensions && node --experimental-strip-types --test private/stardock/test/worker-dashboard-notifications.test.ts
```

Expected signal: all dashboard bound and notification transition tests pass in the lane worktree.
