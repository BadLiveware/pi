# 00c: Stage Ownership and State Safety

## Goal

Prevent multiple Pi runtimes or sibling mutations from clobbering stage/WorkerRun lifecycle state while a parallel stage owns a loop.

## Dependencies

- Slices 00a and 00b integrated.

## Scope

In scope:

- Cross-process stage lock file and owner mutation token.
- Atomic lock lifecycle and stale-lock reconciliation evidence.
- Guarded read-modify-write by stable ids.
- Rejection of non-owner mutations during active stage execution.
- Detached/reconciling/retry-ready statuses and attempt preservation.

Out of scope:

- Concurrent workers.
- Automatic stale-lock takeover.
- Fan-in/integration.

## Affected areas

- New `src/stages/ownership.ts`
- State store guarded-mutation seam
- Runtime/tool mutation guard integration
- `test/stage-ownership.test.ts`

## Required references

- Cross-process ownership section in [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)
- [`../docs/validation.md`](../docs/validation.md)

## Tasks

1. Implement separate long-lived `stage-owner` and short-lived `state-mutation` files. The mutex records session id, pid, token digest, graph/stage id, and acquired time. Owner acquisition generates a token, writes `acquiring` with `wx`, then under the mutation mutex checks expected revision/digests, records ownership in atomic state, and promotes the matching owner record to `active`. On stale revision, remove only the caller's matching acquiring record with no state/lease mutation.
2. Add the guarded mutation API: bounded-wait for the short mutex, reload, check caller revision when external, require owner token when active/internal, update stable ids, atomically replace state, increment revision, release mutex. Reconcile may quarantine/unlink a stale mutex only after pid/session/token/owner-record checks prove the holder dead; PID alone is insufficient.
3. While a stage lock is active, reject every non-owner Stardock mutation with bounded owner/stage/status/reconcile guidance; keep read-only state/policy/list/status available. Existing worker review and stage actions obtain the token only from the matching runtime owner registry.
4. Add owner heartbeat from first run through review/fan-in. Release ownership only after integrated/explicitly abandoned terminal state and lease disposition; expiry marks suspicion only and never auto-takes-over.
5. Add default read-only reconciliation inspection for lock/session/pid/state evidence. `takeOwnership: true` requires old-owner liveness checks plus rationale/approval evidence and produces a new token only after worker/Treehouse ownership is classified; refuse takeover while the prior owner is live.
6. Add durable node statuses `detached`, `reconciling`, and `retry_ready`, preserving immutable prior attempts. Guard pause/complete/cancel/archive/clean/nuke and legacy stop/abandon aliases: owner pause cancels/detaches; no path may delete/terminalize an owned stage outside explicit stage abandon/release semantics.
7. On session shutdown, use the owner token to record detached running attempts/stage, stop heartbeat, and leave the ownership record for reconciliation; abrupt death leaves the same durable evidence.
8. Add two-process/runtime tests for simultaneous first acquisition, stale revision rollback, kill while holding the short mutex, safe stale-mutex quarantine/reacquisition, death in each owner transition, direct cancel/nuke/legacy-stop attempts, owner mutation, rejected sibling mutation, serialized completions, heartbeat, approved takeover, and read-only availability.

## Acceptance criteria

- [ ] A non-owner Pi runtime cannot overwrite stage/WorkerRun state during execution.
- [ ] External mutations reject stale revisions; owner completions update distinct stable ids without lost sibling results.
- [ ] Stale/expired locks are never auto-cleared; reconcile evidence and approval are required.
- [ ] Read-only status remains available while the stage is owned; owner review/fan-in remains guarded after workers settle.
- [ ] Detached/retry state preserves every prior attempt/ref.
- [ ] No worker fan-out starts in this slice.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/stage-ownership.test.ts \
  private/stardock/test/lifecycle.test.ts
```

Expected signal: cross-runtime race fixtures pass with no lost update or unauthorized mutation.
