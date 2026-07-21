# Parallel Stardock Stages and Treehouse Isolation

## Purpose

Define contract-first divide-and-conquer execution: persist a complete dependency graph, freeze shared interfaces once, run ready non-overlapping implementation nodes concurrently in leased Treehouse worktrees, and fan reviewed branches into one validated integration branch before downstream nodes become ready.

## Decision

Stardock models implementation as a directed acyclic graph (DAG), not only a serial checklist.

- An **execution node** is a contract, serial implementation, parallel implementation, or fan-in unit with explicit dependencies and resource ownership.
- A **contract node** defines interfaces, invariants, fixtures, write/resource ownership, and validation for downstream implementations.
- A **parallel stage** groups implementation-node ids that share one contract/base commit and may run concurrently when ready.
- A **fan-in node** owns deterministic branch integration, shared-file wiring, combined validation, and release.
- Treehouse provides durable reusable worktree leases. Stardock owns graph validation, lane contracts, worker execution, lifecycle evidence, integration readiness, and lease records.

Parallel mutable workers remain forbidden in the same checkout. Multiple implementers are allowed only in distinct Treehouse leases inside one validated stage.

## Persisted graph shape

The exact module layout may differ, but persisted state retains these semantics:

```ts
interface ExecutionGraph {
  id: string;
  revision: number;
  status: "draft" | "running" | "blocked" | "completed" | "abandoned";
  nodes: ExecutionNode[];
  stages: ExecutionStage[];
  createdAt: string;
  updatedAt: string;
}

interface ExecutionNode {
  id: string;
  kind: "contract" | "serial" | "implementation" | "fan_in";
  objective: string;
  dependsOn: string[];             // globally unique node ids, including cross-stage edges
  briefId?: string;
  briefDigest?: string;              // canonical digest frozen at stage contract
  writes: string[];
  reads: string[];
  resourceClaims: ResourceClaim[];
  validationCommands: string[];
  status: "blocked" | "ready" | "leased" | "running" | "detached" | "reconciling" |
          "needs_review" | "succeeded" | "failed" | "retry_ready" |
          "integrated" | "abandoned";
  attempts: ExecutionAttempt[];
}

interface ResourceClaim {
  key: string;                      // e.g. "port:4317", "db:status-fixture", "cache:npm"
  mode: "shared" | "exclusive";
  value?: string;                   // allocated port/path/database when relevant
}

interface ExecutionStage {
  id: string;
  contractNodeId: string;
  implementationNodeIds: string[];
  fanInNodeId: string;
  status: "draft" | "contracts_ready" | "running" | "awaiting_integration" |
          "integration_prepared" | "integrated" | "failed" | "detached" | "abandoned";
  parentBranch: string;
  integrationBaseCommit: string;
  contractCommit: string;
  contractDigest: string;            // canonical node/brief/ownership/resource contract digest
  integrationBranch: string;
  maxConcurrency: number;
  integrationOrder: string[];       // implementation node ids
  integration?: IntegrationRecord;
}

interface ExecutionAttempt {
  id: string;
  workerRunId?: string;
  baseCommit: string;
  branchRef: string;
  laneCommits: string[];            // ordered commits after base
  headCommit?: string;
  worktreePath?: string;
  leaseHolder?: string;
  validation: Array<{ command: string; result: "passed" | "failed" | "skipped"; summary: string }>;
  startedAt: string;
  completedAt?: string;
}

interface IntegrationRecord {
  status: "building" | "prepared" | "integrated" | "failed";
  expectedParentHead: string;
  integrationBranch: string;
  laneMerges: Array<{
    nodeId: string;
    sourceHeadCommit: string;
    mergeCommit: string;
  }>;
  fanInCommits: string[];
  integrationHeadCommit: string;
  prepareTokenDigest?: string;
  preparedAt?: string;
  parentResultCommit?: string;
  validation: Array<{ command: string; result: "passed" | "failed" | "skipped"; summary: string }>;
}
```

WorkerRun gains optional graph/stage/node/attempt ids, `isolation: "current_workspace" | "treehouse"`, base/head commits, and bounded lease refs. Full absolute worktree paths remain private details/state and are not injected into every prompt.

## Graph validation

Before any stage executes:

1. Every node and stage id is unique.
2. Every dependency, contract, implementation, and fan-in node id exists.
3. Kahn/topological validation proves the whole graph acyclic and returns an exact cycle/candidate set on failure.
4. Cross-stage dependencies are represented by node `dependsOn`; a stage is ready only when its contract and all external dependencies are integrated.
5. Contract/fan-in nodes are serial and each belongs to at most one stage role.
6. Parallel implementation nodes have disjoint normalized write claims. Shared generated/output files are fan-in-owned.
7. `resourceClaims` do not conflict: two exclusive claims with the same key cannot run together; shared claims require an explicitly concurrency-safe resource; ports/databases/cache paths have unique allocated values where required.
8. Every implementation node names a brief plus canonical digest, exact writes/reads, validation commands, and clean committed result contract. Stage upsert records one canonical contract digest; `runReady` re-hashes current briefs/contracts and rejects drift.
9. The parent branch head, `integrationBaseCommit`, and `contractCommit` are exact immutable SHAs and equal for a stage; the commit satisfies recorded dependency ancestry. A changed contract/base creates a new stage generation/attempts.

The planner computes the DAG. Stardock validates and records it; Stardock does not infer semantic independence from filenames alone. `upsert` derives initial blocked/ready/contract-integrated states from verified dependencies and base evidence rather than trusting caller-supplied status strings.

## Serial bootstrap

Parallel execution is bootstrapped through five serial, independently validated nodes:

1. **00a graph/state contracts:** persisted DAG, node/stage/attempt/integration types, migration defaults, and pure graph/resource validation.
2. **00b Treehouse adapter:** exact CLI contract, lease acquisition/verification, frozen-base branch creation, status inspection, and safe return.
3. **00c execution ownership/state safety:** cross-process stage lock, mutation token, atomic lock-file lifecycle, stale-lock reconciliation, and state-update serialization.
4. **00d runReady orchestration:** worker execution refactor, pre-created WorkerRuns, bounded concurrent bridge runs, per-node attempts, commit/ownership validation.
5. **00e fan-in/recovery dogfood:** integration branch, no-ff lane merges, recordIntegrated verification, reconcile/retry/abandon/release, and real disposable Treehouse proof.

No later parallel stage starts until 00e passes.

## Stardock tool contract

`stardock_stage` provides bounded actions with stable request keys:

- `upsert({ graph, expectedGraphRevision? })`: validate and record graph/stage/nodes. Creation omits the revision; update must match it.
- `list({ graphId?, stageId? })`: inspect bounded graph/stage/node/attempt status and return current revision.
- `runReady({ graphId, stageId, nodeIds?, expectedGraphRevision })`: acquire ownership/leases and run ready implementation nodes up to stage concurrency.
- `integrationPlan({ graphId, stageId, expectedGraphRevision })`: return accepted refs, ordered lane commits/heads, expected parent head, integration branch, resource/conflict preflight, and exact parent-owned merge commands.
- `prepareIntegration({ graphId, stageId, expectedGraphRevision, integrationHeadCommit, laneMerges, fanInCommits, validation })`: verify clean committed integration branch, source-head ancestry/mappings, passing validation, and unchanged parent ref; atomically persist `prepared` evidence and return a one-use prepare token plus exact fast-forward commands.
- `recordIntegrated({ graphId, stageId, prepareToken, parentResultCommit })`: idempotently verify the prepared token/evidence and exact parent result, then transition to integrated. If final recording is interrupted, durable `prepared` state makes same-token retry or reconciled token reissue safe.
- `reconcile({ graphId, stageId, takeOwnership?, rationale?, approvalRef? })`: inspect durable lock/lease/branch/worktree/prepared state. Default is read-only; takeover requires old-owner liveness checks plus rationale/approval evidence. For unchanged durable `prepared` evidence it may reissue a finalization token after verifying parent is still expected or already exactly at the prepared head.
- `retry({ graphId, stageId, nodeIds, expectedGraphRevision, rationale })`: create new attempts/branches/leases without overwriting old refs.
- `abandon({ graphId, stageId, expectedGraphRevision, rationale, approvalRef? })`: cancel owned runs, preserve dirty/failed leases, and never force-clean.
- `release({ graphId, stageId, expectedGraphRevision, nodeIds? })`: return only integrated or explicitly abandoned clean leases. Dirty/unreviewed leases remain leased.

Every externally initiated mutation before preparation uses revision compare-and-swap. `recordIntegrated` uses the one-use token bound to the prepared revision/head so a retry cannot fail merely because the parent ref advanced as instructed. Internal worker completions additionally require the owner token and stable run/node/attempt ids.

Lifecycle gates consume graph state:

- completion readiness blocks while any graph/stage/node is nonterminal, any review/fan-in is pending, any ownership record is unreconciled, or any lease lacks integrated/abandoned disposition;
- pause from the owning runtime cancels active runs and leaves the stage detached/reconcilable; non-owner pause/complete/archive/clean/nuke is rejected with owner/reconcile guidance;
- archive/clean/nuke never delete lock/lease evidence for a nonterminal stage;
- workflow status and policy expose exact review, retry, reconciliation, integration, or release next action.

`runReady` is one parent tool invocation. It pre-creates WorkerRuns in one guarded mutation, launches bridge requests concurrently with bounded concurrency, applies completion updates through the owner mutation token, streams per-node progress, and returns one aggregate result. Children never mutate Stardock state.

## Cross-process state ownership

Process-local queues are insufficient. Use two files beside loop state: a long-lived exclusive `stage-owner` record and a short-lived `state-mutation` mutex.

Exact first-acquisition order:

1. Generate the random token in memory and exclusively create (`wx`) an `acquiring` owner record containing graph/stage, session id, pid, token digest, expected graph revision, and timestamps. If it exists, stop with owner/reconcile guidance.
2. Acquire the short state-mutation mutex, reload state, and compare the expected revision/contract digests/readiness. On mismatch, release the mutex and remove only the still-matching `acquiring` record; no state or lease changed.
3. In the first atomic state replacement, record stage ownership/status and increment revision. Then atomically replace the owner record with `active` plus the committed state revision and release the state mutex.
4. Only after durable ownership exists, acquire leases serially, append attempts/WorkerRuns through guarded mutations, and begin bridge fan-out after every started lane has a persisted run. Partial setup failure settles/records acquired nodes and returns only clean unused leases.
5. If death occurs during `acquiring` or between state/owner transitions, reconcile compares token digest, state revision, pid/session, and lease evidence before takeover; it never guesses or auto-deletes.

The owner runtime refreshes heartbeat from first `runReady` through review/fan-in/release. Every state mutation takes the short mutex, reloads current state, and atomically replaces it by stable ids. Only the owning runtime presenting the token may mutate while ownership is active; existing `stardock_worker review` and stage actions obtain it from the runtime owner registry. Other mutations return busy/owner guidance; read-only tools remain available.

Session shutdown cancels owned bridge runs, records detached state when possible, stops heartbeat, and leaves the owner record for reconciliation. This prevents cross-runtime lost updates and serializes non-stage mutations for the full owned stage lifecycle.

## Treehouse lifecycle

For each ready implementation node:

1. `treehouse get --lease --lease-holder stardock:<loop>:<stage>:<node>:<attempt>` returns an absolute path.
2. Verify managed repository identity and a clean worktree.
3. Verify the parent branch remains at `integrationBaseCommit` and the stage's exact `contractCommit` is reachable.
4. Reset the lease to `contractCommit` and create a collision-resistant branch `stardock/<loop>/<stage>/<node>/<attempt>-<short-id>`. Existing refs are never overwritten.
5. Run one implementer with that worktree as `cwd`, exact write/resource ownership, and a contract-change stop rule.
6. Require node-local validation, ordered commits after base, clean status, changed paths within ownership, and recorded head SHA.
7. Parent reviews WorkerRun/report/diff. A node becomes integration-ready only after acceptance.
8. Fan-in uses a dedicated integration branch created at `integrationBaseCommit`. Merge accepted node branches with `git merge --no-ff --no-edit` in recorded order, preserving lane commit ancestry.
9. Apply fan-in-owned wiring/docs/tests, commit them, require a clean integration worktree, and run stage validation. On failure, parent remains untouched and leases/refs remain preserved.
10. Call `prepareIntegration` to durably verify/store mappings, fan-in commits, clean head, validation, unchanged parent ref, and a one-use token.
11. Run the returned fast-forward, require parent HEAD equals the prepared integration head, then call idempotent `recordIntegrated` with the token. Clean leases may return only afterward.

## Integration and rollback policy

- Contract commit first; implementation nodes never revise frozen interfaces silently.
- Contract defect: node stops; parent updates the contract, records a new contract commit/attempt generation, and retries affected nodes from that base.
- Integration order follows graph order, not completion time.
- Parent branch must remain at the recorded expected head throughout a stage; drift blocks fan-in and requires rebase/replanning.
- Merge conflicts abort that node merge on the integration branch. Preserve refs/lease, record paths, and retry/rebase or create an explicit parent integration node.
- Failed fan-in validation leaves the dedicated integration branch for diagnosis; parent branch is unchanged. Delete/reset that branch only after evidence preservation and explicit decision.
- Do not release a lease before commits are integrated, preserved on an approved ref, or explicitly abandoned.

## Reconcile and retry

After shutdown or lost transport:

- running nodes become/display detached when no local activity exists; an awaiting-review/integration stage whose owner session exited is also detached until takeover;
- `reconcile` compares Treehouse lease holder/path, branch ref, base/head SHA, cleanliness, worker evidence, and lock owner;
- clean committed work becomes `needs_review`; clean unchanged work can become `retry_ready`; dirty work stays `detached` and blocks release; missing/inconsistent lease/ref becomes failed with exact evidence;
- `retry` creates a new attempt and collision-resistant branch. Prior attempt refs/evidence remain immutable;
- no model session is assumed resumable.

## Status projection

The canonical snapshot supports aggregate stage counts, one deterministic primary worker, a bounded attached-worker list, review-needed nodes, detached nodes, and fan-in next action. Stardock automatically projects these facts into the persistent widget; no stage/status command is required. Footer/tool rows are supplemental and dashboard/state tools provide deeper inspection.

Primary widget:

```text
Stardock · visibility · stage status-impl · 4/5 running
A activity · bash · 8 tools
B snapshot · test · 3 tools
C worker-card · needs review
Next: review C; fan-in waits for A/B/D/E
```

Supplemental footer:

```text
sd visibility · stage status · 4 workers · 2 bash/1 test · 1 review
```

## Failure model

- Lease acquisition failure: node remains ready/blocked; clean unused leases return.
- Worker failure: node fails; siblings may finish; fan-in blocks until retry or explicit abandonment.
- Contract/write/resource violation: node fails review; preserve lease/ref and restart after contract/ownership decision.
- Session shutdown: cancel owned runs, mark attempts detached when possible, preserve durable leases/lock evidence.
- Integration conflict: abort merge on integration branch; parent branch unchanged.
- Fan-in validation failure: integration branch and leases remain; parent branch unchanged.
- Parent drift: block fast-forward and require a new integration base/replan.

## Plan DAG

```text
00 baseline
  -> 00a graph/state
  -> 00b Treehouse adapter
  -> 00c ownership/state safety
  -> 00d runReady
  -> 00e fan-in/recovery dogfood
  -> 01 status contract
       -> {01a activity, 01b selector, 01c worker card, 01d passive widget/footer, 01e dashboard/notifications}
       -> 02 status fan-in
       -> 02a cleanup/API contract
            -> {03 command cleanup, 04 API migration}
            -> 04a cleanup/API fan-in
            -> approval -> 05 removals
            -> 06 hard schema-v4 cutover/restart
            -> 06a state-retirement contract
                 -> {07 evolve deletion, 08 flat deletion}
                 -> 08a state-retirement fan-in
                 -> 09 dynamic loading
```

## Rejected alternatives

- Parallel sibling workers in the main checkout: source/state races.
- Raw subagents with unrecorded worktrees: invisible lifecycle/evidence.
- Moving branch-name bases: inconsistent contracts.
- Automatic integration on completion: bypasses review/dependency order.
- Cherry-pick with source-head ancestry verification: cherry-pick changes identities; dedicated no-ff integration branches preserve lane ancestry.
- Process-local mutex only: cannot prevent another Pi runtime from clobbering state.
- Automatic stale-lock deletion: unsafe without Treehouse/branch/session reconciliation.
- Filename-only parallel inference: misses semantic/resource conflicts.

## Execution relationship

- Bootstrap: Slices 00a–00e.
- Treehouse commands and disposable proof: [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md).
- Primary parallel wave: Slice 01 plus lanes 01a–01e and Slice 02 fan-in.
- Later contract/fan-in nodes: Slices 02a/04a and 06a/08a; Slice 06 is a hard state cutover and fresh-loop restart, not a migration gate.
