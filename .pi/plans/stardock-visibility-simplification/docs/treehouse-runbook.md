# Treehouse Parallel Lane Runbook

## Purpose

Give the parent exact safe commands and evidence requirements for Treehouse-leased Stardock nodes and no-ff fan-in.

## Prerequisites

- `/usr/bin/treehouse` works and Slices 00a–00e passed.
- Parent checkout is clean, on recorded `PARENT_BRANCH`, and exactly at `EXPECTED_PARENT_HEAD`/`INTEGRATION_BASE_SHA`.
- `treehouse.toml` has reviewed repo-safe settings (`max_trees = 6`) and no executable repo hooks.
- The full DAG passes dependency/cycle/write/resource validation.
- `CONTRACT_SHA` comes from the recorded contract node; never derive it from a moving branch or unverified current `HEAD`.

## Pool inspection

```bash
treehouse --version
treehouse status
```

Unknown or dirty leases block new automated allocation until inspected.

## Recorded inputs

Copy exact values from `stardock_stage list/integrationPlan`:

```bash
export LOOP=stardock-visibility-simplification
export STAGE=status-implementations
export NODE=activity
export ATTEMPT=attempt-1
export PARENT_BRANCH=main
export EXPECTED_PARENT_HEAD=<recorded-sha>
export INTEGRATION_BASE_SHA=<recorded-sha>
export CONTRACT_SHA=<recorded-sha>
export LANE_BRANCH="stardock/${LOOP}/${STAGE}/${NODE}/${ATTEMPT}-<recorded-id>"
export LEASE_HOLDER="stardock:${LOOP}:${STAGE}:${NODE}:${ATTEMPT}"

test "$(git branch --show-current)" = "$PARENT_BRANCH"
test "$(git rev-parse HEAD)" = "$EXPECTED_PARENT_HEAD"
test "$EXPECTED_PARENT_HEAD" = "$INTEGRATION_BASE_SHA"
test "$CONTRACT_SHA" = "$INTEGRATION_BASE_SHA"
```

Replace angle-bracket values with recorded SHAs/ids. Every test must exit 0.

## Acquire and anchor one node

```bash
WORKTREE="$(treehouse get --lease --lease-holder "$LEASE_HOLDER")"
test -z "$(git -C "$WORKTREE" status --porcelain=v1 --untracked-files=all)"
! git show-ref --verify --quiet "refs/heads/$LANE_BRANCH"
git -C "$WORKTREE" switch --detach "$CONTRACT_SHA"
git -C "$WORKTREE" switch -c "$LANE_BRANCH"
test "$(git -C "$WORKTREE" rev-parse HEAD)" = "$CONTRACT_SHA"
```

On branch collision, do not overwrite/delete it. Record a new attempt/suffix. The adapter performs equivalent operations with argument arrays.

## Worker contract

Each brief contains graph/stage/node/attempt ids, exact contract SHA, write/read paths, resource claims, forbidden fan-in files, validation, contract-change stop rule, clean committed result requirement, and output contract (branch, base/head, ordered commits, changed paths, validation, risks).

A needed contract change stops the node. Parent updates/revalidates the contract and creates new attempts.

## Completion checks

```bash
test -z "$(git -C "$WORKTREE" status --porcelain=v1 --untracked-files=all)"
git -C "$WORKTREE" log --reverse --format='%H' "$CONTRACT_SHA"..HEAD
git -C "$WORKTREE" diff --name-only "$CONTRACT_SHA"...HEAD
```

Require clean status, ordered commits (or explicit no-change), owned paths only, and passing/explicitly blocked node validation. Do not return the lease.

## Review and integration plan

Review and accept/dismiss every WorkerRun/Report, then call `stardock_stage action=integrationPlan`. Verify its parent head, node order, source heads, conflict/resource preflight, and integration branch.

## Dedicated fan-in branch

```bash
export INTEGRATION_BRANCH="stardock/integration/${LOOP}/${STAGE}/<recorded-id>"
test "$(git branch --show-current)" = "$PARENT_BRANCH"
test "$(git rev-parse HEAD)" = "$EXPECTED_PARENT_HEAD"
! git show-ref --verify --quiet "refs/heads/$INTEGRATION_BRANCH"
git switch -c "$INTEGRATION_BRANCH" "$INTEGRATION_BASE_SHA"
```

Merge accepted branches in recorded order:

```bash
git merge --no-ff --no-edit "$LANE_BRANCH"
MERGE_COMMIT="$(git rev-parse HEAD)"
git merge-base --is-ancestor <recorded-node-head-sha> "$MERGE_COMMIT"
```

Record node id, source head, and merge commit. On conflict:

```bash
git status --short
git merge --abort
```

Record paths; retry/rebase the node or create an explicit parent integration fix. Parent branch remains unchanged.

## Fan-in commit, validation, preparation, and fast-forward

Apply fan-in-owned wiring/docs/tests on `INTEGRATION_BRANCH`, commit every accepted change, record ordered fan-in commits, and require `git status --porcelain=v1 --untracked-files=all` empty. Never validate an uncommitted integration result.

Run all stage-wide checks on `INTEGRATION_BRANCH`. For the status wave:

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/worker-status.test.ts \
  private/stardock/test/worker-ui.test.ts \
  private/stardock/test/brief-worker-runs.test.ts \
  private/stardock/test/views.test.ts \
  private/stardock/test/lifecycle.test.ts
```

If validation fails, preserve branch/leases and diagnose; parent is unchanged. If it passes, call `stardock_stage prepareIntegration` with integration head, lane mappings, fan-in commits, and validation. It durably verifies clean committed state, ancestry/mappings, passing checks, and unchanged parent ref, then returns a one-use token and exact commands equivalent to:

```bash
INTEGRATION_HEAD="<prepared-integration-head>"
git switch "$PARENT_BRANCH"
test "$(git rev-parse HEAD)" = "$EXPECTED_PARENT_HEAD"
git merge --ff-only "$INTEGRATION_BRANCH"
test "$(git rev-parse HEAD)" = "$INTEGRATION_HEAD"
```

Call idempotent `stardock_stage recordIntegrated` with the prepare token and exact parent result. If the call is interrupted, do not rebuild or reset: retry/finalize from durable `prepared` state.

## Release

After `recordIntegrated`:

```bash
treehouse return "$WORKTREE"
treehouse status
```

Never use `--force` for normal completion. Dirty/unreviewed leases stay leased with a recorded decision. Force-return needs explicit approval after evidence is preserved/abandoned.

## Reconcile/retry

1. Call `stardock_stage reconcile`; compare lock owner, lease holder/path, branch, base/head, cleanliness, and WorkerRun evidence.
2. Clean committed work becomes reviewable; clean unchanged work may become retry-ready; dirty work remains detached; missing/inconsistent ownership fails explicitly.
3. Use `retry` for a new immutable attempt/branch. Never overwrite prior refs.
4. Do not assume a model session is resumable or auto-clear an expired lock.

## Cleanup and rollback

- Abort conflicts with `git merge --abort`.
- Failed validation leaves the dedicated integration branch; parent needs no destructive reset.
- Return only integrated or explicitly abandoned clean leases.
- Remove lane/integration refs only after evidence and rollback windows close.
- `treehouse prune`, `destroy`, and `return --force` are not normal completion.

## Use from execution files

- Required by Slices 00b–00e and every parallel contract/lane/fan-in.
- Lane files own implementation scope; this runbook owns lease, integration, recovery, and release mechanics.
