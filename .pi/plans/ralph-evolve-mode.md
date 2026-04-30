# Ralph Evolve Mode Plan

## Status

Design-first follow-up. Do not implement `evolve` mode until recursive mode has been dogfooded on real optimization/debugging tasks and the evidence below is available.

## Decision

Keep `mode: "evolve"` reserved. The safe next step is to define the candidate/archive/evaluator state shape and implementation gates, not to run candidate search yet.

Evolve mode should be implemented only when all of these are true:

- evaluator command contract is explicit;
- command timeout and output byte caps exist;
- candidate archive size and prompt summary bounds exist;
- candidate isolation strategy is chosen;
- criterion/evidence handling exists so candidate prompts do not replay the full plan;
- verification artifact handling exists for evaluator logs, benchmark outputs, and screenshots if relevant;
- auditor gate handling exists for entering evolve mode and applying candidate patches;
- recursive dogfooding shows that attempt logs are insufficient for metric-driven candidate selection.

## Purpose

Support metric-driven optimization loops inspired by OpenEvolve:

```text
seed candidate -> mutate -> evaluate -> archive -> select next candidate
```

Ralph should remain inspectable and interruptible. The extension should not become an unbounded autonomous optimizer.

Evolve mode should also follow the context-routing rule: prompts receive bounded candidate/archive summaries, selected criterion IDs, and the next requested mutation, not the full canonical plan or full evaluator logs. Entering evolve execution and applying candidate patches should require auditor review or explicit user approval.

## Evidence needed before implementation

Gather this from recursive dogfooding first:

- What recursive attempt reports lacked for candidate selection.
- Whether validation output needs structured parsing or simple text summaries are enough.
- Whether candidates need patch/worktree isolation.
- Which metrics are stable enough to optimize.
- How many candidates are useful before prompt/archive bloat appears.
- Whether evaluator runtime is short and deterministic enough for interactive loops.
- Whether a criterion ledger is sufficient to trace requirements to candidate evidence.
- Whether evaluator output should be stored as artifacts, evidence journals, or compact metric summaries.
- Which evolve actions require two-key governor/auditor agreement versus direct user approval.

## Data/state shape

Future setup:

```ts
interface EvolveSetup {
  seedFiles: string[];
  evaluatorCommand: string;
  primaryMetric: string;
  metricGoal: "minimize" | "maximize";
  archiveSize: number;
  candidateBudget: number;
  patience?: number;
  mutationPolicy: "small_diff" | "rewrite_candidate";
  timeoutMs: number;
  maxEvaluatorOutputBytes: number;
  maxPromptCandidates: number;
  isolation: "advisory_patch" | "worktree";
}
```

Future candidate state:

```ts
interface EvolveCandidate {
  id: string;
  parentId?: string;
  iteration: number;
  summary: string;
  patchFile?: string;
  changedFiles: string[];
  metrics: Record<string, number | string>;
  primaryScore?: number;
  criterionIds: string[];
  evidenceSummary?: string;
  verificationArtifacts: Array<{ kind: "benchmark" | "test" | "smoke"; path?: string; summary: string }>;
  status: "accepted" | "rejected" | "invalid" | "best";
  evaluatorOutputFile?: string;
  createdAt: string;
}

interface EvolveModeState {
  kind: "evolve";
  setup: EvolveSetup;
  candidates: EvolveCandidate[];
  bestCandidateId?: string;
  archive: string[];
  consecutiveNonImproving: number;
}
```

## Ownership and invariants

- Ralph state owns candidate metadata, not large evaluator output.
- Large outputs and patches live in artifact files referenced by path.
- Evaluator command must be user-provided and workspace-local.
- Candidate application must be explicit and reversible.
- Archive summaries must be capped before prompt inclusion.
- The user or parent/orchestrator must be able to inspect between candidate attempts.
- Auditor review or explicit user approval gates evolve entry, criteria relaxation, and automatic candidate patch application.

## Options considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| Keep evolve reserved | No unsafe automation; more dogfood evidence first | Delays optimizer | Current choice |
| Prompt-only evolve inside recursive mode | Reuses current flow | Weak candidate/archive semantics | Use only for dogfood |
| Advisory patch candidates | Safer, reviewable | Parent must apply patches | First implementation candidate |
| Worktree candidates | Better isolation | More operational complexity; git cleanliness requirements | Later candidate |
| Direct in-place mutations | Simple to code | Unsafe rollback and review | Reject |

## Candidate lifecycle

Initial safe lifecycle should be advisory-patch based:

1. Create candidate proposal from current best/archive summary.
2. Store candidate summary and optional patch artifact.
3. Parent/user applies or rejects patch explicitly.
4. Evaluator command runs with timeout and byte cap.
5. Parse or summarize metrics.
6. Update archive with bounded size.
7. Prompt next candidate or stop based on budget/patience.

Do not start with fully automatic patch application.

## Evaluator contract

Minimum evaluator behavior:

- command exits zero for valid evaluation;
- command exits non-zero for invalid candidate or infrastructure failure;
- stdout/stderr are captured with byte caps;
- evaluator runtime has timeout;
- primary metric can be extracted manually at first or via a simple configured regex later.

Future optional metric extraction:

```ts
interface MetricExtractor {
  metric: string;
  regex: string;
  type: "number" | "string";
}
```

Avoid complex parser/plugin systems until simple regex/manual summaries fail.

## Performance and safety bounds

Required before implementation:

- `archiveSize` default and maximum.
- `candidateBudget` default and maximum.
- `timeoutMs` required with sane maximum.
- `maxEvaluatorOutputBytes` required.
- `maxPromptCandidates` required.
- Candidate summaries capped by count and character length.
- Large artifacts stored outside state.
- No unbounded candidate fanout.

Scaling variables:
- number of candidates;
- changed files per candidate;
- evaluator runtime;
- evaluator output bytes;
- archive summary size;
- patch size;
- number of metrics.

## Prompt shape

Evolve prompts are specialized `IterationBrief`s for candidate work. They should include only:

- objective and primary metric;
- current best candidate summary;
- bounded archive summary;
- evaluator command and constraints;
- baseline/current-best metric evidence when available;
- selected criteria and pass conditions relevant to the candidate;
- any auditor findings or gate constraints relevant to this candidate;
- one requested mutation/candidate action;
- explicit instruction to record candidate metadata, criterion evidence, and validation result.

Do not include full evaluator logs or full patches in prompts unless small and necessary.

## Validation plan

Before code:

- Write a small design fixture with fake evaluator output.
- Decide whether advisory patch or worktree isolation is first.
- Confirm how candidate artifacts are named and cleaned.

First implementation tests:

- start evolve mode validates required setup and bounds;
- invalid setup fails without writing partial loop state;
- baseline evaluator evidence can be recorded before candidate changes;
- candidate metadata is capped and persisted;
- evaluator output is byte-capped and linked as an artifact when useful;
- archive truncates at `archiveSize`;
- prompt includes only bounded candidate summaries, selected criteria, and relevant auditor constraints;
- gated evolve actions surface auditor/user-approval requirements;
- checklist and recursive modes remain unchanged.

Manual smoke:

- tiny metric optimization with a fake evaluator command;
- invalid evaluator command is reported and does not corrupt state;
- completion marker still completes the loop without synthetic user message errors.

## Implementation gates

Do not implement evolve mode until:

- recursive mode has at least one real dogfood case with structured attempt reports;
- evaluator command safety bounds are accepted;
- candidate isolation choice is accepted;
- expected archive/prompt sizes are documented;
- criteria-to-candidate evidence handling is designed;
- evaluator artifact handling and baseline comparison are designed;
- auditor gate handling is accepted or user explicitly approves bypassing it;
- user approves moving from design to implementation.

## Non-goals

- No MAP-Elites/islands in the first evolve implementation.
- No parallel candidate execution initially.
- No automatic in-place code mutation.
- No evaluator plugin framework.
- No hidden background optimization loop.
