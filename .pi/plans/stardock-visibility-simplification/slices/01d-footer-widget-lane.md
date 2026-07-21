# 01d: Passive Widget and Footer Lane

## Goal

Implement the primary passive persistent-widget projection and a supplemental bounded footer/status projection for serial and parallel Stardock snapshots.

## Dependencies

- Slices 00a–00e parallel foundation integrated and Slice 01 contract/stage committed.
- Slice 01 contract commit frozen.

## Treehouse lane

- Lane id: `status-footer-widget`
- Writable areas: `src/status/footer.ts`, `src/status/widget.ts`, `test/worker-footer-widget.test.ts`.
- Forbidden: shared contracts, snapshot/activity implementation, `runtime/ui.ts`, tool renderer, dashboard/notifications.

## Tasks

1. Implement a four-to-six-line widget projection with loop/stage aggregate, up to three primary worker/lane lines, the highest-priority review/failure/detached fact, and next action.
2. Make the widget sufficient for ordinary awareness when footer status is hidden and no dashboard/status/state tool is invoked.
3. Implement a one-line supplemental extension-status projection for no-loop, serial worker, multiple lanes, needs-review, failed, blocked, and ready-to-complete states.
4. Ensure footer compresses aggregate state while the widget retains the critical progress/review/failure/next-action facts.
5. Show governor/outside/reflection context only when it supplies the active blocker/next action or no worker/stage status is more important.
6. Add width-aware truncation and tests across narrow/wide terminals, one/five workers, mixed tools, review/failure, detached stage, and no active loop.
7. Document expected Footer Framework extension-status adapter value shape in test fixtures; do not edit user config.
8. Commit cleanly and report base/head SHA, paths, validation, and contract issues.

## Acceptance criteria

- [ ] Widget remains at most six lines, prioritizes workers/review/failure/detachment/next action, and is useful with footer hidden and no user-invoked inspection.
- [ ] Footer remains one bounded supplemental line and reports aggregate stage state usefully.
- [ ] All lines satisfy visible-width bounds.
- [ ] Projection functions have no runtime/UI side effects.
- [ ] Changed paths stay inside lane ownership and the worktree is clean/committed.

## Validation

```bash
cd agent/extensions && node --experimental-strip-types --test private/stardock/test/worker-footer-widget.test.ts
```

Expected signal: all projection/width/prioritization tests pass in the lane worktree.
