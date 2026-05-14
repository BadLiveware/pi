# Stardock Subagent-Driven Recursive Mode Plan

## Status

Explicit tool-gated advisory execution is now implemented for brief-scoped explorer/test-runner work. The current private Stardock implementation owns durable loop state, attempt reports, outside requests, ready-to-copy governor/researcher payloads, provider-neutral advisory handoffs, WorkerReports, brief-derived advisory worker payloads, parent-owned explorer/test-runner adapter payloads, and one explicit `pi-subagents` bridge runner for active briefs. Broader subagent execution should remain parent/orchestrator-driven until Stardock has lifecycle, cancellation, result capture, edit ownership, and review policy for each role.

Implemented safe adapter/execution slice:

- `stardock_brief({ action: "payload" })` builds provider-neutral advisory worker payloads from active or selected briefs.
- `stardock_advisory_adapter({ action: "payload", role: "explorer" | "test_runner" })` formats ready-to-run parent-owned `pi-subagents` invocation arguments for brief-scoped advisory workers.
- `stardock_brief_worker({ action: "run", role: "explorer" | "test_runner" })` explicitly starts one brief-scoped advisory worker through the `pi-subagents` bridge, saves file-only output under `.stardock/runs/<loop>/workers/` by default, and records a compact WorkerReport.
- Adapter payloads are convenience output only: they do not execute providers, persist provider-specific state, apply edits, or create hidden worker runs.
- Brief-worker runs are never automatic on brief creation and are limited to advisory explorer/test-runner roles; they do not implement, apply patches, create hidden fanout, or make provider-specific state the source of truth.
- Recorded `AdvisoryHandoff` and `WorkerReport` summaries are included in later prompts when scoped to the active brief criteria.

## Decision

Allow only explicit, advisory, brief-scoped Stardock execution for low-risk worker roles. The safe shape remains a parent/governor-orchestrated workflow behind a provider-neutral firewall:

1. Stardock creates durable outside requests, briefs, auditor reviews, or `AdvisoryHandoff` payloads using Stardock-owned concepts.
2. The parent/orchestrator may run any provider (`pi-subagents`, another extension, a CLI, a human review, or a future adapter) using those payloads.
3. For active briefs that need only file mapping or bounded validation, the parent/governor may call `stardock_brief_worker({ action: "run" })` to execute one `pi-subagents` explorer/test-runner without a payload-copying round trip.
4. The parent records or verifies compact answers with `stardock_outside_answer`, `stardock_attempt_report`, `stardock_auditor`, `stardock_handoff`, or the WorkerReport produced by `stardock_brief_worker`.
5. Stardock includes recorded decisions/results in later prompts as constraints or evidence.

The current `pi-subagents` bridge is an execution convenience for advisory brief workers, not a state contract. Implementer/editing workers and broader direct provider execution still require separate design gates.

## Context routing principle

Do not paste the full canonical plan into every worker iteration. The plan and task file are durable source material; the governor should route only the context needed for the next bounded attempt.

A worker should receive an `IterationBrief`, not the whole plan:

```ts
interface IterationBrief {
  id: string;
  objective: string;
  task: string;
  criterionIds: string[];
  acceptanceCriteria: string[];
  verificationRequired: string[];
  requiredContext: string[];
  constraints: string[];
  avoid: string[];
  outputContract: string;
  sourceRefs: string[];
}
```

The governor should preserve compact durable understanding in state rather than relying on chat history:

```ts
interface GovernorState {
  objective: string;
  currentStrategy?: string;
  completedMilestones: string[];
  activeConstraints: string[];
  knownRisks: string[];
  openQuestions: string[];
  nextContextHints: string[];
  rejectedPaths: Array<{ summary: string; reason: string }>;
}
```

This is also the main anti-ditch mechanism: the implementer executes one brief; the governor decides whether the next brief continues, pivots, measures, requests research, or stops.

Worker briefs should be verification-led when criteria exist: route selected criterion IDs, pass conditions, and test methods; do not ask workers to infer completion from a large plan.

## Context and constraints

- Current safe boundary: extension state and prompts are deterministic and inspectable.
- Current Stardock tools already prove the equivalent concepts:
  - `stardock_govern`
  - `stardock_outside_payload`
  - `stardock_outside_answer`
  - `stardock_attempt_report`
  - `stardock_auditor`
  - `stardock_handoff`
- `sd_*` aliases remain optional future ergonomics only; they are not implemented now.
- Extension-side automatic subagent execution risks hidden edits, unclear ownership, interruption ambiguity, and hard-to-review agent fanout.
- User must be able to inspect and interrupt between attempts.
- Implementer attempts must stay bounded: one decision, one attempt, one report.
- Prefer low-risk exploration and test-runner subagents before implementer subagents.
- Checklist mode should remain simple, but legacy v1 state migration is not a requirement for private Stardock unless there is active local state worth importing.

## Subagent role order

Direct subagent support, if added, should progress through roles in this order:

1. **Explorer** — advisory only. Returns file/symbol map, relevant tests, validation commands, context gaps, and risk notes. It should not edit files.
2. **Test runner** — advisory only. Runs noisy validation, stores full logs as artifacts, and returns compact failure summaries tied to criteria.
3. **Researcher** — advisory only. Supplies ideas, examples, or failure analysis when requested by the governor.
4. **Governor** — advisory direction-setting role; should remain separate from implementer execution.
5. **Auditor** — advisory oversight role. Reviews governor direction, criteria integrity, evidence quality, and automation gates; does not implement.
6. **Implementer** — bounded attempt only, and only after edit ownership/isolation is solved.

## Data/state shape

Existing state remains the source of truth:

- `LoopState`: loop lifecycle, mode, iteration, task file.
- `RecursiveModeState`: objective, setup fields, attempts.
- `RecursiveAttempt`: structured attempt report.
- `OutsideRequest`: governor/researcher/auditor work item.
- `GovernorDecision`: recorded steer for subsequent prompts.
- `AuditorReview`: recorded oversight findings for governor decisions and gated moves.

Current provider-neutral firewall state includes:

```ts
interface AdvisoryHandoff {
  id: string;
  role: "explorer" | "test_runner" | "researcher" | "reviewer" | "governor" | "auditor" | "implementer";
  status: "draft" | "requested" | "answered" | "failed" | "dismissed";
  objective: string;
  summary: string;
  criterionIds: string[];
  artifactIds: string[];
  finalReportIds: string[];
  contextRefs: string[];
  constraints: string[];
  requestedOutput: string;
  provider?: Record<string, unknown>; // opaque adapter metadata only
  resultSummary?: string;
  concerns: string[];
  recommendations: string[];
  artifactRefs: string[];
  createdAt: string;
  updatedAt: string;
}
```

`AdvisoryHandoff` is the firewall: Stardock owns objective, role, evidence links, output contract, and compact result fields. Provider run IDs, transcript URLs, model names, and runner-specific status belong only in opaque optional `provider` metadata and must not become the source of truth.

Future direct execution adapters may add:

```ts
interface VerificationArtifact {
  kind: "test" | "smoke" | "curl" | "browser" | "screenshot" | "walkthrough" | "benchmark";
  command?: string;
  path?: string;
  summary: string;
  criterionIds?: string[];
}

interface FailureDiagnosis {
  criterionId: string;
  observedFailure: string;
  likelyCause: string;
  fixApplied?: string;
  retestEvidence?: string;
}

interface AuditorReview {
  verdict: "aligned" | "minor_concerns" | "direction_drift" | "evidence_gap" | "scope_creep" | "premature_completion" | "needs_user_decision";
  findings: Array<{ severity: "info" | "warning" | "blocker"; summary: string; recommendation: string }>;
  requiredGovernorAction?: string;
  forbiddenNextMoves?: string[];
}

interface WorkerReport {
  objective: string;
  summary: string;
  changedFiles: string[];
  behaviorChanged: string[];
  evaluatedCriteria: string[];
  validation: Array<{ command: string; result: "passed" | "failed" | "skipped"; summary: string }>;
  verificationArtifacts: VerificationArtifact[];
  failureDiagnoses: FailureDiagnosis[];
  risks: string[];
  openQuestions: string[];
  suggestedNextMove?: string;
  reviewHints: string[];
}

interface WorkerRun {
  id: string;
  requestId: string;
  role: "explorer" | "test_runner" | "governor" | "auditor" | "implementer" | "researcher";
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

Do not add provider-specific execution state until an execution path exists that can maintain it reliably. Keep adapter metadata optional, opaque, and replaceable.

## Ownership and change authority

- Stardock extension owns its private state path, prompt construction, and request/answer recording.
- Parent/orchestrator owns tool execution, subagent invocation, review, and whether to apply edits.
- Implementer subagents must not own the overall loop direction.
- Governor decisions may constrain the next prompt but should remain inspectable and rejectable with a recorded reason.
- Auditor blocker findings may gate the next governor move, but must remain inspectable and rejectable only with rationale or user override.
- The governor should consume worker reports and artifacts, not re-derive all context by rereading every changed file.
- Parent/governor review should read touched files only when risk, ambiguity, failed validation, public contract changes, or worker review hints justify it.

## Options considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| Parent-orchestrated advisory workflow | Safe now; uses existing tools; inspectable; no hidden edits | More manual steps | Still valid default |
| Extension returns exact subagent payloads only | Small improvement over manual; still safe | Parent still runs tools | Implemented for brief-scoped explorer/test-runner adapter payloads via `stardock_advisory_adapter` |
| Explicit tool-gated advisory subagents | Removes payload-copying round trip; still one visible parent/governor decision; no direct edits | Depends on `pi-subagents` bridge availability; role scope must stay narrow | Implemented for brief-scoped explorer/test-runner via `stardock_brief_worker` |
| Extension directly spawns broad/ad hoc subagents | Less manual | Needs safe lifecycle handling per role and risks hidden fanout | Future only |
| Extension spawns editing subagents in current workspace | Fastest automation | Unsafe ownership, interruption, rollback risks | Reject |
| Extension spawns worktree-isolated implementers | Safer edits | Requires clean git/worktree orchestration and patch review | Future research |

## Chosen future shape

If direct subagent support is later added, start with **advisory-only direct subagents**, especially explorer, test-runner, and auditor roles:

1. Stardock creates a `WorkerRun` from a pending `OutsideRequest`, auditor request, or governor-selected brief.
2. The worker returns text plus artifact refs only; no file edits are applied automatically.
3. Stardock records the answer into the request, audit record, or worker report.
4. The next prompt consumes the compact answer and artifact summaries.
5. The parent/user can inspect all state before the next attempt.

Only after advisory explorer/test-runner/auditor mode proves useful should parent-applied patches or worktree implementation attempts be considered.

## Boundaries, contracts, and invariants

- One worker run maps to one request.
- One implementer run maps to one bounded attempt.
- Every worker run must have a durable payload and a recorded result or failure.
- Direct execution must never bypass `outsideRequests`, `GovernorDecision`, `AuditorReview`, or `RecursiveAttempt` state.
- Editing workers require an explicit edit policy and rollback story before implementation.
- No background fanout without user-visible state and interruption points.
- No worker should receive the entire canonical plan by default; prompts should be selected context packets.
- Worker reports must identify evaluated criteria, changed files, validation evidence, artifact refs, risks, and which files are worth parent review.
- Large or complex worker-produced changes may require a maintainer-facing walkthrough before final completion to avoid cognitive debt.
- High-risk moves such as editing subagents, automatic patch application, evolve execution, or unresolved completion require auditor review or explicit user approval.

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

Before broader direct subagent execution:

- Dogfood explicit `stardock_brief_worker` explorer/test-runner workflow on real loops.
- Record where manual execution is still too slow or error-prone.
- Verify extension API or bridge support for each added role's lifecycle, cancellation/interruption, and result capture.
- Add tests for request → worker payload → answer recording → prompt inclusion for every new role.
- Add tests for auditor blocker findings gating the next governor move without direct implementation changes.
- Manual smoke: advisory worker answer affects the next prompt, no automatic edits occur.

Before editing workers:

- Choose edit policy: parent-applied patches or worktrees.
- Define rollback and conflict handling.
- Add tests or manual smoke for failed worker, interrupted worker, and rejected patch.
- Ensure user can inspect before applying changes.

## Implementation handoff

Next implementable slice, when justified:

1. Dogfood `stardock_advisory_adapter` explorer/test-runner payloads on real loops and record friction before adding direct execution.
2. Add `WorkerRun` state behind a feature flag or explicit mode option only after execution lifecycle requirements are clear.
3. Implement advisory-only explorer execution first, if a safe extension API exists.
4. Add test-runner worker execution with log artifacts and compact summaries.
5. Add auditor worker handling for oversight payloads and findings before any editing workers.
6. Record worker answers through the same `stardock_outside_answer`/`sd_outside_answer`/report/audit path.
7. Keep checklist and ordinary recursive mode unaffected.

## Non-goals

- No automatic editing in the current workspace.
- No hidden subagent fanout.
- No evolve/candidate archive work in this plan.
- No replacement for parent/orchestrator judgment.
