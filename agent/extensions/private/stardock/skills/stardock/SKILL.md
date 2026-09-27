---
name: stardock
description: Use when a finite body of work has meaningful dependencies or independent jobs that should run as a governor-controlled DAG while the outside agent preserves request context and semantic authority. Avoid for simple one-shot or open-ended work.
---

# Stardock

Stardock is a loose DAG orchestration framework for finite work.
You are the governor: preserve the user's request context, define jobs, interpret reports, and own accept, retry, abandon, supersede, integration, and completion decisions.
Stardock provides isolated scheduling, compact dependency handoffs, durable evidence, resource cleanup, and recovery; treat its checks and recommendations as advisory unless they protect a mechanical safety invariant.

A node is an arbitrary job, not a PR, branch, mandatory implementation task, or delivery boundary.
A node may return a report, research findings, a decision recommendation, throw-away test results, artifacts, commits, or no filesystem changes.
If combined code or delivery is needed, model integration, promotion, cherry-picking, combined validation, or release as explicit dependent nodes.
Use `stardock_integrate` only as an optional compatibility/convenience operation for persisted accepted commit outputs.

Use Stardock when finite work has useful dependency structure, even if one ready set has width one, or when independent jobs materially benefit from isolation and fan-out.
Do not use it for a one-file fix with no useful graph structure or for open-ended experimentation.

## Governor workflow

1. Author the DAG with `stardock_plan`.
For a compact graph, omit `action` and submit the complete sealed plan once.
For a large graph, create a draft, upsert bounded node groups, then seal it.
2. Express research, shared setup, interfaces, schemas, contracts, or other enabling work as `kind: "prerequisite"` nodes when later jobs depend on their outputs.
Ordinary nodes use `kind: "work"` or omit it.
3. Give every independent job its real prerequisites in `dependsOn`; do not serialize siblings merely because they share a prerequisite.
4. Seal before execution.
Sealing validates the complete graph; `stardock_run` refuses drafts and sealed authoring is immutable.
5. Call `stardock_run` once for the complete ready antichain.
A width-one ready set is naturally serial.
6. Inspect the returned reports, artifacts, validation observations, risks, and focused diffs when present.
Call `stardock_review` with accept, retry/reject, or abandon decisions for the settled `runId` values you are ready to decide.
7. Continue with newly ready nodes, retry with a rationale, supersede the graph, call `stardock_complete` when you judge the work done, or optionally promote accepted commits.
Unresolved graph, review, validation, auditor, or policy state becomes advisory completion warnings; do not insert `stardock_integrate` merely because a wave was accepted.

Use `stardock_status` after compaction, on resume, or when graph state is unclear.
It returns compact state, pending review IDs, warnings, and available actions; it does not own the semantic choice among safe actions.

The normal calls need no internal graph or lease identifiers:

```js
stardock_run({})
stardock_status({})
stardock_complete({})
```

Pass `name` only when operating on a plan other than the active one.

## When Stardock is stuck

If a foreign owner, interrupted terminal cleanup, or preserved lease blocks ordinary tools, call `stardock_recover({ action: "inspect", name? })`. It is available on the primary surface even when normal mutations are blocked and returns exact graph/stage/revision, owner liveness, running workers, pending lease IDs, and viable recovery actions.

Choose one scoped action from that inspection: `relinquishSettled` fences only a terminal stage (or a detached, fully decided plan) with no active worker or attempt; `takeover` requires confirmed owner death, no active worker/attempt evidence, and worker/Treehouse classification; `reconcileResources` inspects preserved attempts read-only before optional `apply: true` under recovered ownership; `finalizeCleanup` clears exact owner evidence left after a committed terminal release; `releaseLeases` retries only verified Treehouse/Git cleanup. Mutating calls require the inspected `graphId`, `stageId`, and `expectedGraphRevision`; ownership changes also require a concrete `rationale` and `approvalRef`. A lease that cannot be verified remains preserved. Recovery does not itself decide that the loop's work is complete; call `stardock_complete` separately when appropriate. Never edit `.stardock` state by hand or treat a stale heartbeat as proof of death.

## Plan shape

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
      task: "Compare candidates and return a concise evidence report.",
      acceptanceCriteria: ["Trade-offs, unknowns, and supporting references are explicit."],
      reads: ["src/auth"],
      validationCommands: []
    },
    {
      id: "security",
      objective: "Evaluate security properties",
      task: "Use the research handoff to assess risks and mitigations.",
      acceptanceCriteria: ["Security risks and mitigations are explicit."],
      dependsOn: ["research"],
      reads: ["src/auth"],
      validationCommands: []
    },
    {
      id: "compatibility",
      objective: "Test compatibility assumptions",
      task: "Run throw-away compatibility experiments and report evidence.",
      acceptanceCriteria: ["Compatibility evidence and uncertainty are explicit."],
      dependsOn: ["research"],
      reads: ["src/auth"],
      validationCommands: ["npm test -- auth-contracts"]
    }
  ]
})
```

Accepted predecessor summaries, artifact IDs, changed paths, branch names, commit identities, and open questions are supplied to dependent workers.
A dependent worker must verify evidence it uses and must not assume predecessor filesystem changes are already present in its isolated lease.

Declare conflicting writes or exclusive resources as dependencies.
A draft may be incomplete, but `seal` rejects missing dependencies, cycles, and conflicting independent ownership.
Upsert replaces nodes with matching IDs and is available only while the plan remains a draft.

## Decision shape

```js
stardock_review({
  decisions: [
    {
      runId: "run12",
      decision: "accept",
      rationale: "The report answers the node question despite an expected failing probe."
    },
    {
      runId: "run13",
      decision: "retry",
      rationale: "The compatibility evidence did not cover legacy tokens."
    }
  ]
})
```

Acceptance records eligible evidence and unlocks dependencies without requiring repository integration.
Failed validation remains visible and is never promoted as passing evidence, but it does not remove your authority to accept a diagnostic or expected-failure result.
No-edit reports are valid when they satisfy the job.
Attempt limits are advisory signals; you may retry beyond them with a concrete rationale, abandon the node, or supersede the plan.

`stardock_run` retains isolated workspaces while their outcomes await your `stardock_review` decision. After the last decision in a wave, Stardock attempts verified lease return automatically and reports the returned count or preservation reason. Accepted branch and commit identities remain available for explicit promotion even after safe return.

If cleanup remains pending, call `stardock_recover({ action: "inspect", name })`; for multiple pending stages, inspect each `pendingLeaseStageIds` entry using `stageId`. Retry `releaseLeases` with the inspected graph identity and revision only after the worker is inactive and Treehouse/Git evidence is safe. Dirty or unverifiable work stays preserved; never discard it just to finish the loop. Cleanup warnings do not reverse your semantic decision, and `stardock_complete` does not claim the leases were returned.

## Boundaries

- Do not create briefs, criteria, graph digests, stage records, routine reviewer workers, or final reports on the normal path; Stardock derives or records them internally.
- Do not call `stardock_run` for only one member of an independent ready set.
- Do not launch a routine reviewer after every worker; your explicit decision over the settled evidence is the trust boundary.
- Do not manually run stage acquire, integration-plan, prepare, finalize, or release actions on the common path.
- Use `stardock_integrate` only when you explicitly choose the compatibility promotion path; if it returns recovery guidance, follow that instruction and preserve recorded branches and attempts.
- `stardock_recover` is the first-class exception to the hidden legacy surface; use it for stuck custody or pending lease cleanup, not routine work orchestration.
- Legacy diagnostic/recovery tools are hidden by default for new plans.
Resuming a planless legacy loop restores its required tools; a human can otherwise enable them for the current session with `/stardock-legacy on` and disable them with `/stardock-legacy off`.
