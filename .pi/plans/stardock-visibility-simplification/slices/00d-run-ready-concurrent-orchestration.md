# 00d: Bounded `runReady` Concurrent Orchestration

## Goal

Run validated ready implementation nodes concurrently in distinct Treehouse leases while one parent-owned tool controls all WorkerRuns, state updates, progress, and cancellation.

## Dependencies

- Slices 00a–00c integrated and validated.

## Scope

In scope:

- `stardock_stage upsert`, `list`, and `runReady` actions.
- Worker execution extraction shared with canonical Stardock role prompts.
- Pre-created Treehouse WorkerRuns/attempts and bounded concurrency.
- Clean committed lane result/ownership/resource validation.
- Aggregate partial/final results.

Out of scope:

- Integration branch/merge/fast-forward operations.
- Reconcile/retry/release beyond preserving failed leases.
- User-visible custom stage cards; generic partial output is sufficient until status lanes.

## Affected areas

- `src/stages/tool.ts`
- `src/stages/run-ready.ts`
- Shared worker invocation extraction
- `src/runtime/feature-tools.ts` and registration wiring
- `test/stage-run-ready.test.ts`
- capability docs/skills needed to invoke the new tool

## Required references

- [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)
- [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md)
- Slices 00a–00c contracts

## Tasks

1. Register `stardock_stage` with bounded `upsert`, `list`, and `runReady` schemas/results; later actions may return explicit not-yet-implemented guidance until Slice 00e. `runReady` acquires/uses stage ownership that remains through review/fan-in.
2. Refactor worker invocation construction/execution into a shared internal API without changing `stardock_worker action=run` behavior or role semantics.
3. Follow the Slice 00c acquisition order: create `acquiring` owner record, mutex/CAS/digest/readiness check, first atomic ownership state write, promote owner active, then acquire/anchor leases serially and persist immutable attempts/WorkerRuns before any bridge fan-out.
4. Execute up to `maxConcurrency` implementers with each lane worktree as `cwd`, exact frozen contract/base, write/resource claims, validation commands, and contract-change stop rule.
5. Stream bounded aggregate progress by node/run while preserving generic tool updates. Child workers never call Stardock mutation tools.
6. Apply each completion through the guarded stable-id mutation API. Record ordered lane commits, head SHA, clean status, changed paths, validation, WorkerReport, and out-of-ownership/contract violations. Mark every stage-associated review as requiring an explicit `runId`; never use the single-open-run default.
7. Keep current-workspace implementers serial. Permit concurrency only for distinct stage nodes/leases owned by this runReady token.
8. On partial lease/worker failure, allow started siblings to settle, return only clean unused leases, preserve failed/dirty leases, and mark stage blocked/failed accurately.
9. On tool cancellation/session shutdown/timeout, cancel owned bridge requests, record detached attempts when possible, preserve leases, and settle the parent promise.
10. Add fake-adapter/bridge tests for 2/5 lanes, reversed completion and review order with mandatory `runId`, cap scheduling, partial acquisition failure, one worker failure, contract/write/resource violation, cancellation, shutdown, and sibling state preservation.
11. Commit and dogfood a fake five-lane stage; do not claim Treehouse end-to-end until Slice 00e real proof.

## Acceptance criteria

- [ ] `runReady` executes at least five fake disjoint nodes with bounded concurrency and no lost lifecycle update.
- [ ] Every lane starts from its recorded contract SHA in a unique lease/ref and returns clean committed evidence or an explicit failed/detached state.
- [ ] Current-workspace serial guard remains intact.
- [ ] Parent tool settles on success, partial failure, cancellation, timeout, and shutdown.
- [ ] No automatic integration or force-return occurs.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/stage-run-ready.test.ts \
  private/stardock/test/stage-ownership.test.ts \
  private/stardock/test/treehouse-adapter.test.ts \
  private/stardock/test/brief-worker-runs.test.ts
```

Expected signal: all bounded fan-out/race/failure tests pass and no real pool lease is required.
