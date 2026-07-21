# 01c: Worker Tool Card Lane

## Goal

Implement contextual call/partial/final worker tool components that enrich active tool invocations without becoming the primary Stardock visibility path.

## Dependencies

- Slices 00a–00e parallel foundation integrated and Slice 01 contract/stage committed.
- Slice 01 contract commit frozen.

## Treehouse lane

- Lane id: `status-worker-card`
- Writable areas: `src/status/worker-tool-renderer.ts`, `test/worker-tool-renderer.test.ts`.
- Forbidden: shared contracts, worker execution/registration wiring, runtime UI/commands, other renderers.

## Tasks

1. Implement call rendering for action, role, stage/lane or brief/request scope, and non-default model/thinking.
2. Implement partial rendering for starting/running/current tool/tool count/elapsed activity and aggregate lane progress when `runReady` owns multiple workers.
3. Implement collapsed final rendering for terminal/review state, changed-file count, report id, output-ref count, and stage lane id.
4. Implement expanded bounded rendering for concrete paths/refs, review hint/rationale, failure summary, and integration readiness.
5. Reuse/mutate `context.lastComponent` where safe, handle `isPartial`, and enforce every rendered line's width.
6. Add narrow/wide, missing-tool, five-lane aggregate, success, needs-review, failed, expanded-bound, and theme-invalidation tests.
7. Commit cleanly and report base/head SHA, paths, validation, and contract issues.

## Acceptance criteria

- [ ] Serial and stage-lane worker calls are distinguishable without dumping args.
- [ ] Partial and final cards expose actionable progress/evidence within width and collection caps.
- [ ] Renderer remains a pure projection and does not own activity selection, worker lifecycle, or any critical fact absent from the passive widget.
- [ ] Changed paths stay inside lane ownership and the worktree is clean/committed.

## Validation

```bash
cd agent/extensions && node --experimental-strip-types --test private/stardock/test/worker-tool-renderer.test.ts
```

Expected signal: all renderer state/width/bound tests pass in the lane worktree.
