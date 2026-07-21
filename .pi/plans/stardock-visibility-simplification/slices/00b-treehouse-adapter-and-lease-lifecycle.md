# 00b: Treehouse Adapter and Lease Lifecycle

## Goal

Implement and validate an argument-safe Treehouse adapter that acquires, anchors, inspects, and safely returns one leased worktree without running workers or mutating stage state concurrently.

## Dependencies

- Slice 00a integrated.

## Scope

In scope:

- Repo `treehouse.toml` with `max_trees = 6` and no executable hooks.
- Adapter for version/status/get-lease/return.
- Repository identity, clean status, exact contract SHA, parent branch/head, and collision-resistant lane branch validation.
- Fake adapter tests and one disposable real lease smoke.

Out of scope:

- `runReady` or multiple concurrent leases.
- Stardock stage mutation lock.
- Worker execution and integration.

## Affected areas

- `treehouse.toml`
- New `src/stages/treehouse-adapter.ts`
- New `test/treehouse-adapter.test.ts`
- Disposable smoke script/test helper if needed

## Required references

- [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md)
- [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)

## Tasks

1. Add repo-safe `treehouse.toml`; keep executable hooks out of repository config.
2. Implement process execution with argument arrays and structured results for version, status, lease, inspect, anchor branch, and safe return.
3. Require recorded `parentBranch`, `integrationBaseCommit`, and `contractCommit` inputs; never derive contract SHA implicitly from moving `HEAD`.
4. Verify the parent checkout is on the recorded branch/head and `contractCommit === integrationBaseCommit === parent HEAD` before lease setup.
5. After lease acquisition, verify managed repo identity and clean status, reset to exact contract SHA, and create a branch `stardock/<loop>/<stage>/<node>/<attempt>-<short-id>` only when the ref does not exist. Generate a new attempt suffix on collision; never overwrite.
6. Return only clean leases through normal `treehouse return`; expose dirty/unmanaged/mismatch as blockers. Never call `--force` in the adapter's normal lifecycle.
7. Add fake CLI tests for paths with spaces, stderr banners, lease failure, dirty status, wrong repo, wrong SHA, branch collision, clean return, and dirty refusal.
8. Run one disposable real lease smoke, return it, and prove `treehouse status` has no accidental retained lease.

## Acceptance criteria

- [ ] Adapter uses exact SHAs and unique non-overwriting branch refs.
- [ ] Dirty, wrong-repo, wrong-base, unmanaged, and collision cases fail safely.
- [ ] Normal return cannot force-clean work.
- [ ] Fake tests and one disposable real lease smoke pass.
- [ ] No worker or stage orchestration exists yet.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test private/stardock/test/treehouse-adapter.test.ts
cd ../.. && treehouse status
```

Expected signal: adapter tests pass and disposable lease is returned.
