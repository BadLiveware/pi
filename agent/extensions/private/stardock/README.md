# Stardock

Stardock is a private Pi framework for running finite dependency graphs.
The outside agent remains the governor: it defines jobs, interprets reports, chooses accept/retry/abandon/supersede actions, and decides whether any code should be promoted.
Stardock supplies scheduling, isolated execution, compact handoffs, durable evidence, resource cleanup, and recovery.

A node is an arbitrary job, not a mandatory implementation task or PR boundary.
A node may return a report, research findings, a decision recommendation, throw-away test results, artifacts, commits, or no filesystem changes.
Internal branches and worktrees are isolation details.
If combined code is needed, model promotion or integration as an explicit DAG node instead of making it an implicit post-wave phase.

The common path is:

```text
plan (one-shot or draft → upsert → seal) → run ready fan-out → governor review → continue, retry, supersede, or complete
```

## Quick start

This example runs research first, fans out two independent evaluations, and leaves the final decision to the governor.
None of the jobs is required to edit files.

```js
stardock_plan({
  name: "auth-options",
  objective: "Choose an authentication design without changing production code",
  constraints: ["Preserve the public token contract"],
  maxConcurrency: 3,
  defaultMaxAttempts: 2,
  integrationValidationCommands: ["npm test"],
  nodes: [
    {
      id: "research",
      kind: "prerequisite",
      objective: "Map viable designs",
      task: "Compare the two candidate authentication designs and return a concise evidence report.",
      acceptanceCriteria: ["The report names trade-offs, unknowns, and supporting references."],
      reads: ["src/auth"],
      validationCommands: []
    },
    {
      id: "security",
      objective: "Evaluate security properties",
      task: "Use the research handoff to assess security risks and return findings.",
      acceptanceCriteria: ["Security risks and mitigations are explicit."],
      dependsOn: ["research"],
      reads: ["src/auth"],
      validationCommands: []
    },
    {
      id: "compatibility",
      objective: "Evaluate compatibility",
      task: "Use the research handoff to test compatibility assumptions; keep experiments throw-away.",
      acceptanceCriteria: ["Compatibility evidence and remaining uncertainty are explicit."],
      dependsOn: ["research"],
      reads: ["src/auth"],
      validationCommands: ["npm test -- auth-contracts"]
    }
  ]
})
```

The omitted `action` defaults to `replace`, which creates and seals the plan in one call.
This graph has a width-one research wave followed by a width-two evaluation wave.
Accepted predecessor reports, artifact references, branch names, commit identities, changed paths, and open questions are packaged into dependent worker prompts.
A dependent worker must verify evidence it relies on and must not assume predecessor filesystem changes are already present in its lease.

For a large graph, author it incrementally:

```js
stardock_plan({
  action: "draft",
  name: "auth-options",
  objective: "Choose an authentication design without changing production code",
  constraints: ["Preserve the public token contract"],
  integrationValidationCommands: ["npm test"]
})

stardock_plan({ action: "upsert", name: "auth-options", nodes: [researchNode] })
stardock_plan({ action: "upsert", name: "auth-options", nodes: [securityNode, compatibilityNode] })
stardock_plan({ action: "seal", name: "auth-options" })
```

A draft may temporarily contain forward dependency references.
Each upsert validates node-local structure and replaces matching node IDs.
Sealing validates missing dependencies, cycles, ownership conflicts, and the complete graph.
`stardock_run` rejects drafts, and sealed plans are immutable.
If requirements change, create a new named plan with `supersedesPlan` and `replanReason`.

Run every currently ready node:

```js
stardock_run({})
```

After the lanes settle, inspect the bounded evidence and decide every returned run together:

```js
stardock_review({
  decisions: [
    { runId: "run1", decision: "accept", rationale: "The report answers the node question." },
    { runId: "run2", decision: "reject", rationale: "The compatibility evidence did not cover legacy tokens." }
  ]
})
```

Acceptance records useful evidence and unlocks dependencies.
Rejection requests another attempt, but attempt limits and failed checks are advisory signals rather than workflow authority.
The governor may accept warning-bearing evidence, retry beyond a declared budget when justified, supersede the plan, or call `stardock_complete` to finish with unresolved advice recorded as warnings.
`stardock_run` leaves isolated workspaces leased while their results await `stardock_review`. After the last decision in a wave, Stardock attempts verified lease return automatically and reports what returned or remained preserved. Dirty or unverifiable work is not discarded; accepted commits remain addressable for later explicit promotion.

Use `stardock_status({})` after compaction or whenever graph state is unclear.
It returns compact progress, pending review IDs, warnings, and available actions without prescribing a single semantically correct choice.

## Optional code promotion

`stardock_integrate` is a compatibility and convenience operation for accepted commit-producing lanes.
It is not required after review.
Prefer an explicit DAG node when promotion, cherry-picking, merge ordering, combined validation, or release is part of the actual work:

```js
{
  id: "promote-candidate",
  objective: "Promote the accepted candidate",
  task: "Use dependency commit refs to assemble the candidate, run combined checks, and report the exact promoted result.",
  dependsOn: ["implementation-a", "implementation-b"],
  acceptanceCriteria: ["The selected commits are combined and the resulting validation evidence is recorded."],
  writes: ["src/auth"],
  validationCommands: ["npm test", "npm run typecheck"]
}
```

The convenience tool remains useful for older execution plans whose persisted state expects a fan-in phase:

```js
stardock_integrate({})
```

Its internal Git identity checks, deterministic merge ordering, durable prepare/finalize state, and recovery behavior remain available without making integration a universal graph transition.

## Primary tools

| Tool | Purpose |
| --- | --- |
| `stardock_plan` | Create a sealed DAG in one call or incrementally draft, upsert, and seal it. |
| `stardock_run` | Execute the complete maximal ready antichain in isolated workers. |
| `stardock_review` | Record governor accept/reject decisions for settled lanes, promote eligible evidence, and attempt safe lease release. |
| `stardock_status` | Return compact graph progress, pending review IDs, warnings, and available actions. |
| `stardock_recover` | Inspect blocked ownership; repair decided custody or confirmed-dead ownership; inspect/classify preserved attempts; finalize interrupted cleanup or verified lease release. |
| `stardock_complete` | Record the governor's completion decision; settled ownership is relinquished while unverifiable leases remain preserved with a cleanup warning. Active worker ownership still blocks completion. |
| `stardock_integrate` | Optionally fan in accepted commit outputs for compatibility or convenience. |

Legacy tools remain registered for existing state and exceptional recovery but are inactive by default for new execution plans.
Resuming a planless legacy loop temporarily restores the tools required by its existing prompt; otherwise use `/stardock-legacy on` for current-session diagnostics.

## Plan model

A plan contains:

- one whole-request objective and compact constraints
- arbitrary job nodes, optionally labeled `prerequisite` or `work`
- explicit dependencies
- observable acceptance criteria
- optional read and write ownership
- shared or exclusive resource claims
- advisory attempt bounds
- optional per-node validation commands
- optional combined-result validation for explicit promotion work or the convenience integration path

A node becomes ready after every dependency is accepted or integrated.
Draft authoring chunks do not affect scheduling; execution begins only after the full graph is sealed.
`stardock_run` selects the complete ready set, while concurrency limits bound simultaneous workers without changing the DAG.

Independent nodes must have disjoint declared writes and non-conflicting exclusive resources.
If ownership overlaps, add a dependency, split the ownership boundary, or redesign the work so the overlap becomes an explicit combining node.
Read-only and report-only siblings can usually run concurrently.

## Governor decisions and advisory signals

Each worker attempt is immutable and tied to one node.
Stardock reports mechanical facts and warnings, while the governor owns their meaning:

- no-edit results are valid when the node produced useful evidence
- validation failures remain visible and are not promoted as passing artifacts
- acceptance may still be appropriate for a diagnostic, research, or expected-failure node
- attempt exhaustion is visible but does not remove the governor's retry authority
- rejection queues another attempt when the governor chooses to continue
- acceptance unlocks dependents without requiring repository integration
- supersession preserves prior attempts and releases inactive leases best-effort

A routine reviewer worker is not inserted between a settled lane and the governor.
The trust boundary is the governor's explicit decision over the returned evidence.
Legacy compatibility surfaces use `governorDecision` and `governorRisk` policy actions for selective evidence routing; both remain advisory and cannot veto completion.

## Resource lifecycle and recovery

Stardock owns the mechanical lifecycle of its isolation resources.
It releases clean settled leases after governor review and attempts to release clean inactive leases when a plan is superseded.
Cleanup failures are returned as warnings with exact recovery context rather than changing the governor's semantic decision. After all plan nodes are decided and no worker is running, `stardock_complete` relinquishes the settled stage's ownership without claiming a preserved lease was returned. `stardock_status` continues to show pending cleanup after loop completion and points to `stardock_recover({ action: "inspect" })`, not a dead-end “none.” If a normal mutation is blocked or cleanup remains pending, inspect recovery: it reports owner/process evidence, pending lease stages, exact graph identity, and applicable actions. Select `stageId` to inspect each stage when several retain leases. Every recovery action except `inspect` needs that identity and revision, including read-only resource reconciliation; custody changes also require a rationale and authorization reference. A live active worker cannot be taken over. `/stardock-stop` interrupts the current session immediately, but leaves foreign or active stage custody intact and reports pending cleanup until workers settle or recovery authorizes release. `reconcileResources` inspects attempt/Treehouse evidence read-only before optional application under recovered ownership; a preserved lease is not marked returned without Treehouse/Git proof. Recovery records an append-only audit event and does not itself decide to complete the loop.

Retrying a subset preserves already accepted or abandoned siblings, including after interrupted-result recovery. New attempts persist a never-dispatched marker, then commit dispatch evidence before invoking the worker. Confirmed-dead takeover can settle exact never-dispatched candidates for review while preserving every lease; dispatched and legacy-unknown active attempts remain blocked. A crash after dispatch commitment but before transport remains conservatively ambiguous. Inspect recovery first, then call `stardock_run` after takeover to restore review IDs.

For the optional integration path, Stardock retains:

- exact original-workspace base, source-head, and internal branch checks
- deterministic no-ff merge order
- clean-worktree and changed-path verification
- durable prepare/finalize state
- idempotent finalization
- safe lease release

Before durable preparation, failed convenience integration removes its generated temporary branch so the operation can be retried.
After durable preparation, rerunning `stardock_integrate` resumes the recorded fast-forward/finalization path.

## State

Workspace-local state remains under:

```text
.stardock/runs/<name>/
  task.md
  state.json
  workers/
```

`task.md` is a human-readable projection.
The execution plan in `state.json` is canonical.

Existing schema-v3 loop state remains readable.
Low-level WorkerRuns, WorkerReports, execution graphs, attempts, leases, ownership records, artifacts, and final reports remain internal reliability and migration records.

## Development

The optional [Lean lifecycle model](models/README.md#retry-and-ownership-recovery-lean) checks the original stalls, repaired progress, and recovery safety. It is an abstraction, not a proof of the TypeScript implementation.

```bash
npm run check:structure --prefix agent/extensions
npm run typecheck --prefix agent/extensions
node --experimental-strip-types --test agent/extensions/private/stardock/test/execution-plan.test.ts
npm test --prefix agent/extensions
./link-into-pi-agent.sh
```
