# Ralph Subagent-Driven Recursive Mode Plan

## Status

Design gate, not implementation-ready. The current Ralph extension owns durable loop state, attempt reports, outside requests, and ready-to-copy governor/researcher payloads. Subagent execution should remain parent/orchestrator-driven until Pi exposes an extension API that can safely run and supervise subagents with inspectable ownership boundaries.

## Decision

Do not make `ralph-loop` spawn subagents directly yet. The next safe shape is an advisory, parent-orchestrated workflow:

1. Ralph creates durable outside requests and payloads.
2. The parent/orchestrator agent runs `subagent` or other tools using those payloads.
3. The parent records answers with `ralph_outside_answer` and attempt outcomes with `ralph_attempt_report`.
4. Ralph includes recorded decisions in the next recursive prompt as constraints.

Only after that workflow is dogfooded should the extension add a direct subagent-driven mode.

## Context and constraints

- Current safe boundary: extension state and prompts are deterministic and inspectable.
- Current tools already support:
  - `ralph_govern`
  - `ralph_outside_payload`
  - `ralph_outside_answer`
  - `ralph_attempt_report`
- Extension-side automatic subagent execution risks hidden edits, unclear ownership, interruption ambiguity, and hard-to-review agent fanout.
- User must be able to inspect and interrupt between attempts.
- Implementer attempts must stay bounded: one decision, one attempt, one report.
- Checklist mode compatibility and v1 state migration must remain unaffected.

## Data/state shape

Existing state remains the source of truth:

- `LoopState`: loop lifecycle, mode, iteration, task file.
- `RecursiveModeState`: objective, setup fields, attempts.
- `RecursiveAttempt`: structured attempt report.
- `OutsideRequest`: governor/researcher work item.
- `GovernorDecision`: recorded steer for subsequent prompts.

Future direct subagent mode may add:

```ts
interface WorkerRun {
  id: string;
  requestId: string;
  role: "governor" | "implementer" | "researcher";
  status: "queued" | "running" | "answered" | "failed" | "dismissed";
  startedAt?: string;
  completedAt?: string;
  payload: string;
  answer?: string;
  error?: string;
  artifactPaths?: string[];
  editPolicy: "advisory_only" | "parent_applied_patch" | "worktree";
}
```

Do not add this state until an execution path exists that can maintain it reliably.

## Ownership and change authority

- Ralph extension owns `.ralph/*.state.json`, prompt construction, and request/answer recording.
- Parent/orchestrator owns tool execution, subagent invocation, review, and whether to apply edits.
- Implementer subagents must not own the overall loop direction.
- Governor decisions may constrain the next prompt but should remain inspectable and rejectable with a recorded reason.

## Options considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| Parent-orchestrated advisory workflow | Safe now; uses existing tools; inspectable; no hidden edits | More manual steps | Current choice |
| Extension returns exact subagent payloads only | Small improvement over manual; still safe | Parent still runs tools | Already implemented via payload helpers |
| Extension directly spawns advisory subagents | Less manual; still no direct edits | Needs safe extension API and lifecycle handling | Future only |
| Extension spawns editing subagents in current workspace | Fastest automation | Unsafe ownership, interruption, rollback risks | Reject |
| Extension spawns worktree-isolated implementers | Safer edits | Requires clean git/worktree orchestration and patch review | Future research |

## Chosen future shape

If direct subagent support is later added, start with **advisory-only direct subagents**:

1. Ralph creates a `WorkerRun` from a pending `OutsideRequest`.
2. The worker returns text only; no file edits are applied automatically.
3. Ralph records the answer into the request.
4. The next prompt consumes the answer.
5. The parent/user can inspect all state before the next attempt.

Only after advisory mode proves useful should parent-applied patches or worktree implementation attempts be considered.

## Boundaries, contracts, and invariants

- One worker run maps to one request.
- One implementer run maps to one bounded attempt.
- Every worker run must have a durable payload and a recorded result or failure.
- Direct execution must never bypass `outsideRequests`, `GovernorDecision`, or `RecursiveAttempt` state.
- Editing workers require an explicit edit policy and rollback story before implementation.
- No background fanout without user-visible state and interruption points.

## Performance shape

Scaling variables:
- number of requests
- number of worker runs
- payload size
- answer size
- number and size of artifacts
- worktree count if worktrees are used later

Bounds before implementation:
- cap payloads to recent N attempts;
- cap answer bytes before prompt inclusion;
- cap pending/running workers per loop;
- require timeouts for worker execution;
- persist large artifacts outside prompt state and summarize them.

## Validation gates

Before direct subagent execution:

- Dogfood parent-orchestrated workflow on at least two real recursive loops.
- Record where manual execution is too slow or error-prone.
- Verify extension API supports safe subagent lifecycle, cancellation/interruption, and result capture.
- Add tests for request → worker payload → answer recording → prompt inclusion.
- Manual smoke: advisory worker answer affects the next prompt, no automatic edits occur.

Before editing workers:

- Choose edit policy: parent-applied patches or worktrees.
- Define rollback and conflict handling.
- Add tests or manual smoke for failed worker, interrupted worker, and rejected patch.
- Ensure user can inspect before applying changes.

## Implementation handoff

Next implementable slice, when justified:

1. Add `ralph_worker_payload` only if `ralph_outside_payload` is insufficient.
2. Add `WorkerRun` state behind a feature flag or explicit mode option.
3. Implement advisory-only worker execution, if a safe extension API exists.
4. Record worker answers through the same `ralph_outside_answer` path.
5. Keep checklist and ordinary recursive mode unaffected.

## Non-goals

- No automatic editing in the current workspace.
- No hidden subagent fanout.
- No evolve/candidate archive work in this plan.
- No replacement for parent/orchestrator judgment.
