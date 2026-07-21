# 00e: Fan-in, Recovery, and Treehouse Dogfood

## Goal

Complete parent-controlled integration, reconcile/retry/release lifecycle, and reproducible real Treehouse proof so later plan nodes can safely use parallel stages.

## Dependencies

- Slices 00a–00d integrated and validated.

## Scope

In scope:

- `integrationPlan`, `prepareIntegration`, `recordIntegrated`, `reconcile`, `retry`, `abandon`, and `release` actions.
- Dedicated integration branch with no-ff lane merges.
- Source-head/integration ancestry and parent fast-forward verification.
- Detached/dirty/missing lease reconciliation and immutable retries.
- Exact disposable-repository end-to-end dogfood.

Out of scope:

- Automatic conflict resolution.
- Force-return/branch deletion without approval.
- User-facing rich stage status; later lanes own rendering.

## Affected areas

- `src/stages/integration.ts`
- `src/stages/reconcile.ts`
- `src/stages/tool.ts`
- `test/stage-integration.test.ts`
- `test/stage-reconcile.test.ts`
- New `test/support/assert-treehouse-dogfood.ts`
- [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md)
- Stardock README/skill/agent capability profiles

## Required references

- [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)
- [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md)
- [`../docs/validation.md`](../docs/validation.md)

## Tasks

1. Add `integrationPlan` returning expected parent branch/head, integration branch, accepted node order, every node's ordered commits/head, preflight resource/path/conflict evidence, and exact no-ff merge commands.
2. Create/verify a unique integration branch at `integrationBaseCommit`; reject existing conflicting refs and parent HEAD drift.
3. Merge accepted node branches into the integration branch with `--no-ff --no-edit` in recorded order. Persist node source head -> merge commit mappings and integration head.
4. Require fan-in-owned changes committed and the integration worktree clean, then run stage-wide validation. On failure, preserve branch/leases and leave parent unchanged.
5. Implement `prepareIntegration` to verify/persist source ancestry, merge mappings, fan-in commits, clean head, passing validation, and unchanged parent ref before returning a one-use token/fast-forward command. Implement idempotent `recordIntegrated` to consume that prepared token after exact parent fast-forward; interrupted finalization remains safely retryable with the same token or a reconciled replacement token after exact prepared/parent verification.
6. Complete `reconcile` for lock, lease, branch, base/head, cleanliness, and WorkerRun evidence, including read-only inspection and guarded `takeOwnership` after prior-owner liveness/approval checks. Map clean committed work to needs-review, clean unchanged to retry-ready, dirty work to detached, and missing/inconsistent ownership to failed with exact evidence.
7. Implement `retry` as a new immutable attempt with a collision-resistant branch/lease; never overwrite prior attempts/refs.
8. Keep the owner token through worker review, integration, and lease disposition. Implement `abandon` and `release`: preserve dirty/unreviewed leases, return only integrated or explicitly abandoned clean leases, release stage ownership only at terminal disposition, and require explicit approval for any force-clean escape hatch outside normal tool behavior.
9. Add integration/recovery tests for uncommitted fan-in rejection, parent drift, branch collision, no-ff ancestry, merge conflict abort, validation failure, durable prepared state, interrupted/idempotent finalization, successful fast-forward, incorrect mapping, dirty/missing lease, stale lock takeover, prepared-token reissue after owner loss, retry preservation, and release gating.
10. Add the dogfood evidence assertion helper, then run the exact procedure below. It must machine-check overlap, distinct leases/paths/branches, exact lane paths, accepted runs, prepared/finalized integration, released lease disposition, and pool destruction before recording artifacts.

## Disposable Treehouse dogfood

Create a temporary repository outside production work:

```bash
DOGFOOD_ROOT="$(mktemp -d /tmp/stardock-treehouse-dogfood.XXXXXX)"
DOGFOOD_ARTIFACTS="$(mktemp -d /tmp/stardock-treehouse-evidence.XXXXXX)"
export DOGFOOD_ROOT DOGFOOD_ARTIFACTS
cd "$DOGFOOD_ROOT"
git init -b main
git config user.name 'Stardock Dogfood'
git config user.email 'stardock-dogfood@example.invalid'
cat > CONTRACT.md <<'EOF'
Create two independent Bash commands. upper.sh prints its single argument in uppercase;
lower.sh prints its single argument in lowercase. Each lane owns its command and test only.
Do not edit CONTRACT.md or the other lane's files.
EOF
printf 'max_trees = 4\n' > treehouse.toml
git add CONTRACT.md treehouse.toml
git commit -m 'Define formatter contract'
export CONTRACT_SHA="$(git rev-parse HEAD^{commit})"
printf 'Recorded contract SHA: %s\n' "$CONTRACT_SHA"
```

After `./link-into-pi-agent.sh` from the source repository, start a fresh `pi` session with `cd "$DOGFOOD_ROOT" && pi` and use the linked Stardock extension. Use these exact operation shapes (substitute returned ids/digests/revisions/SHAs):

1. `stardock_start({ name: "treehouse-dogfood", mode: "checklist", taskContent: "- [ ] Implement/test uppercase command\n- [ ] Implement/test lowercase command\n- [ ] Integrate and validate both commands" })`.
2. `stardock_brief upsert` two briefs. `upper` owns only `upper.sh`/`test-upper.sh`; `lower` owns only `lower.sh`/`test-lower.sh`. Each stops on contract changes, creates one commit, and finishes clean. Brief acceptance requires these exact executable fixtures:

```bash
# upper.sh
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" | tr '[:lower:]' '[:upper:]'

# test-upper.sh
#!/usr/bin/env bash
set -euo pipefail
test "$(./upper.sh hello)" = 'HELLO'

# lower.sh
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" | tr '[:upper:]' '[:lower:]'

# test-lower.sh
#!/usr/bin/env bash
set -euo pipefail
test "$(./lower.sh HELLO)" = 'hello'
```

3. `stardock_stage({ action: "upsert", graph: { id: "dogfood", nodes: [contract integrated at CONTRACT_SHA, upper ready depends contract, lower ready depends contract, fan-in blocked depends upper/lower], stages: [{ id: "formatters", contractNodeId: "contract", implementationNodeIds: ["upper", "lower"], fanInNodeId: "fan-in", parentBranch: "main", integrationBaseCommit: CONTRACT_SHA, contractCommit: CONTRACT_SHA, maxConcurrency: 2, integrationOrder: ["upper", "lower"] }] } })`. Supply exact brief digests, writes, empty/conflict-free resource claims, validation, and collision-free integration branch; record the returned contract digest/revision.
4. `stardock_stage({ action: "runReady", graphId: "dogfood", stageId: "formatters", expectedGraphRevision: <revision> })`; verify two leases/runs overlap.
5. Review/accept both WorkerRuns from the owning session using explicit returned `runId` values (including reversed completion order), then call `integrationPlan` and export exact branch refs.
6. Before merging, machine-check ownership:

```bash
test "$(git diff --name-only "$CONTRACT_SHA"..."$UPPER_BRANCH" | LC_ALL=C sort | paste -sd, -)" = 'test-upper.sh,upper.sh'
test "$(git diff --name-only "$CONTRACT_SHA"..."$LOWER_BRANCH" | LC_ALL=C sort | paste -sd, -)" = 'lower.sh,test-lower.sh'
```

Run returned integration-branch/no-ff commands. No fan-in source is expected; if metadata is added, commit and record it. Require `test -z "$(git status --porcelain=v1 --untracked-files=all)"` and run `bash test-upper.sh && bash test-lower.sh`.
7. Call `stardock_stage({ action: "prepareIntegration", graphId: "dogfood", stageId: "formatters", expectedGraphRevision: <revision>, integrationHeadCommit: <sha>, laneMerges: <node/source/merge mappings>, fanInCommits: <ordered commits>, validation: <passing records> })`.
8. Run the returned fast-forward, require `main` equals the prepared head, then call `stardock_stage({ action: "recordIntegrated", graphId: "dogfood", stageId: "formatters", prepareToken: <token>, parentResultCommit: <same-sha> })`.
9. `stardock_stage({ action: "release", graphId: "dogfood", stageId: "formatters", expectedGraphRevision: <revision> })`; verify no lease and preserved source heads.

Rollback after merge or validation failure:

- abort an in-progress merge with `git merge --abort`;
- keep/delete the unvalidated integration branch only after recording diagnostics;
- parent `main` remains at `CONTRACT_SHA` until validation succeeds, so no destructive reset is needed;
- keep leases/branches for retry or explicitly abandon cleanly.

Successful evidence export and disposable cleanup:

```bash
set -euo pipefail
cd "$DOGFOOD_ROOT"
case "$DOGFOOD_ROOT" in /tmp/stardock-treehouse-dogfood.*) ;; *) exit 91 ;; esac
test "$PWD" = "$DOGFOOD_ROOT"
test "$(git rev-parse --show-toplevel)" = "$DOGFOOD_ROOT"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test -d .stardock
rm -rf -- "$DOGFOOD_ARTIFACTS/stardock-state"
cp -a .stardock "$DOGFOOD_ARTIFACTS/stardock-state"
printf 'CONTRACT_SHA=%s\nUPPER_BRANCH=%s\nLOWER_BRANCH=%s\nINTEGRATION_BRANCH=%s\n' \
  "$CONTRACT_SHA" "$UPPER_BRANCH" "$LOWER_BRANCH" "$INTEGRATION_BRANCH" \
  > "$DOGFOOD_ARTIFACTS/refs.env"
git log --graph --oneline --decorate --all > "$DOGFOOD_ARTIFACTS/git-graph.txt"
treehouse status | tee "$DOGFOOD_ARTIFACTS/treehouse-status-before-destroy.txt"
if awk '$2 == "leased" { found=1 } END { exit !found }' \
  "$DOGFOOD_ARTIFACTS/treehouse-status-before-destroy.txt"; then
  printf 'Refusing cleanup: disposable Treehouse pool still has a lease.\n' >&2
  exit 92
fi
! grep -Fq 'stardock:treehouse-dogfood' "$DOGFOOD_ARTIFACTS/treehouse-status-before-destroy.txt"
node --experimental-strip-types \
  /home/fl/code/personal/pi/agent/extensions/private/stardock/test/support/assert-treehouse-dogfood.ts \
  "$DOGFOOD_ARTIFACTS/stardock-state" "$CONTRACT_SHA"
treehouse destroy --help > "$DOGFOOD_ARTIFACTS/treehouse-destroy-help.txt"
treehouse destroy . --all --yes | tee "$DOGFOOD_ARTIFACTS/treehouse-destroy.txt"
treehouse status | tee "$DOGFOOD_ARTIFACTS/treehouse-status-after-destroy.txt"
grep -Fq 'No worktrees in pool' "$DOGFOOD_ARTIFACTS/treehouse-status-after-destroy.txt"
cd /
rm -rf -- "$DOGFOOD_ROOT"
test ! -e "$DOGFOOD_ROOT"
```

The assertion helper fails unless both attempts overlap (`a.startedAt < b.completedAt` and vice versa), use distinct worktree/lease/branch ids, start at `CONTRACT_SHA`, have exact owned paths and accepted runs, preserve source heads in finalized integration, and show released disposition. `destroy . --all --yes` is safe-default bulk cleanup: no `--include-unlanded`, `--include-in-use`, or `--include-leased` flags are allowed. On any failure, stop before destroy/remove, preserve evidence, reconcile/retry/abandon, then rerun the same assertions and cleanup.

## Acceptance criteria

- [ ] Prepared integration durably records clean committed fan-in, source ancestry, exact mappings, validation, and expected parent before fast-forward; final recording is idempotent.
- [ ] Parent drift/conflict/validation failure leaves parent branch unchanged.
- [ ] Reconcile/retry can recover detached work without overwriting attempts or force-cleaning leases.
- [ ] Disposable two-lane Treehouse execution overlaps, integrates, validates, records, and releases end to end.
- [ ] `treehouse status` has no accidental retained dogfood lease; failed/dirty fixtures remain only when intentionally preserved.
- [ ] Later plan stages may now rely on `stardock_stage runReady` and the runbook.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/stage-integration.test.ts \
  private/stardock/test/stage-reconcile.test.ts \
  private/stardock/test/stage-run-ready.test.ts \
  private/stardock/test/treehouse-adapter.test.ts
cd ../.. && npm test --prefix agent/extensions
treehouse status
```

Expected signal: focused/full checks and disposable end-to-end dogfood pass with clean pool state.
