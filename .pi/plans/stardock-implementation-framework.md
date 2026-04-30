# Stardock Implementation Framework Plan

## Purpose

Evolve the local loop work that started as `ralph-loop` into **Stardock**, a private Pi implementation framework for governed agentic work. Stardock turns plans into criteria, routes compact context to bounded workers, records evidence, and uses governor/auditor checkpoints to prevent drift before completion.

The former Ralph loop implementation is useful source material and history, but it is not a compatibility contract. New framework work happens in the private Stardock extension with clean commands, tools, and state.

The design should make room for an OpenEvolve-inspired mode, but should not jump directly to full evolutionary search until the engine, criterion ledger, verification artifacts, governor/auditor workflow, and recursive attempt logging are stable.

## Naming and packaging decision

- Framework name: **Stardock**.
- Keep it private while it is experimental:
  - extension path: `agent/extensions/private/stardock/`
  - do not publish or list as a public extension until the framework is proven.
- The former public Ralph loop implementation has been moved into `agent/extensions/private/stardock/`; there is no longer a public Ralph-loop extension in this repo.
- Current live API namespace:
  - commands: `/stardock` and `/stardock-stop`;
  - tools: `stardock_*`;
  - state path: `.stardock/`.
- `/sd` and `sd_*` aliases remain optional future ergonomics only; they are not implemented yet.
- Prefer a clean Stardock API and state path over preserving `.ralph/`, `/ralph`, or `ralph_*`. One-shot import/reset of old local state is acceptable because this is private.
- Architecture diagrams live at `agent/extensions/private/stardock/docs/architecture-diagrams.md`.

## Desired end state

- Stardock is a private implementation framework extension, not a public Ralph-loop package.
- Existing `ralph_*` callers do not need to keep working after Stardock extraction unless temporary aliases are intentionally added for convenience.
- A loop can declare a `mode` that changes setup requirements, prompt shape, state tracking, stop conditions, and UI summaries.
- Supported initial modes:
  - `checklist`: current behavior, for known finite work.
  - `recursive`: try/test/reset loops for open-ended idea search until budget, target, or idea exhaustion.
- Planned future mode:
  - `evolve`: OpenEvolve-inspired candidate/archive/evaluator loop for metric-driven optimization.
- The extension can ask for outside help at configured points, such as every N iterations or when the main loop reports it is out of ideas.
- Outside help is represented as a structured request in loop state first; subagent/research execution can be added behind that interface later.
- Recursive/optimization loops have a stronger review checkpoint that can look across attempts, detect local-lane fixation, and steer the main loop away from scaffolding-only or low-value work.
- The long-term recursive/evolve architecture supports a manager/worker shape where a governor owns loop direction and implementers own bounded attempts, rather than letting the implementer unilaterally decide whether its current lane remains valuable.

## Non-goals for the first implementation pass

- Do not implement full OpenEvolve/MAP-Elites in the first pass.
- Do not add background autonomous processes or parallel island execution yet.
- Do not require Docker/worktrees for normal checklist or recursive loops.
- Do not spend effort preserving legacy `.ralph/<name>.state.json` compatibility; migrate, import, or reset local state only if useful.
- Do not publish Stardock while it is experimental.
- Do not make outside research automatically spawn subagents until the request/response data model is stable.
- Do not put all subagent orchestration directly inside the extension until Pi exposes a clean, safe extension API for that. The extension should own state and requests first; the parent/orchestrator agent can run subagents through existing tools.

## Current implemented baseline

Last updated: 2026-04-30.

Implemented and committed before the private Stardock move:

- `6eccd8e refactor: add Ralph checklist mode state`
- `251732e feat: validate Ralph loop modes`
- `a8fe4f1 feat: add Ralph recursive mode`
- `3088421 feat: add Ralph outside request workflow`
- `cb8cfee docs: update Ralph modes plan status`
- `945b100 feat: record Ralph attempt reports`
- `bf22925 feat: build Ralph outside request payloads`
- `a233c34 feat: trigger Ralph recursive outside help`
- `a66512c feat: add manual Ralph governor helper`
- `417f768 docs: gate future Ralph automation`

Implemented and committed as private Stardock:

- `fceb41d feat: move Stardock extension private`
- `8a52d2d docs: add Stardock architecture diagrams`

Implemented behavior:

- Modes:
  - `checklist`: default finite-work loop behavior.
  - `recursive`: bounded attempts with objective/setup state, attempt reports, outside requests, governor decisions, and trigger support.
  - `evolve`: reserved; design-gated in `.pi/plans/stardock-evolve-mode.md`.
- State behavior:
  - managed private runs live under `.stardock/runs/<name>/` with `task.md` and `state.json`;
  - archived managed runs live under `.stardock/archive/<name>/` with the same file shape;
  - state remains schema-versioned and mode-aware;
  - legacy flat `.stardock/<name>.state.json` state remains readable for local resilience;
  - legacy `.ralph/` compatibility is not required, though a one-shot importer can be added if useful.
- Tools:
  - `stardock_start`
  - `stardock_done`
  - `stardock_state`
  - `stardock_ledger`
  - `stardock_brief`
  - `stardock_attempt_report`
  - `stardock_govern`
  - `stardock_outside_requests`
  - `stardock_outside_payload`
  - `stardock_outside_answer`
- Commands:
  - `/stardock start <name|path> [options]`
  - `/stardock stop`
  - `/stardock resume <name>`
  - `/stardock status`
  - `/stardock cancel <name>`
  - `/stardock archive <name>`
  - `/stardock clean [--all]`
  - `/stardock list --archived`
  - `/stardock govern [loop]`
  - `/stardock outside [loop]`
  - `/stardock outside payload <loop> <request-id>`
  - `/stardock outside answer <loop> <request-id> <answer>`
  - `/stardock nuke [--yes]`
  - `/stardock-stop`
- Recursive behavior:
  - structured attempt reports carry hypothesis, kind, action summary, validation, result, keep/reset, evidence, and follow-up ideas;
  - `outsideHelpEvery` preserves interval governor reviews;
  - `governEvery` provides independent governor cadence;
  - stagnation creates `failure_analysis` requests;
  - scaffolding drift creates `mutation_suggestions` requests;
  - `stardock_govern` creates a manual governor request and payload without calling a model or spawning subagents;
  - recorded governor decisions appear as constraints in subsequent recursive prompts.

Dogfood notes from `dogfood-stardock-recursive-mode`:

- Attempt reporting, manual governor payload creation, and `stardock_outside_answer` worked as a coherent parent-orchestrated workflow.
- After `stardock_done`, answered governor decisions remained in `.stardock/` state with structured `decision` fields and a `consumedAt` timestamp, giving the next prompt/state a durable steer.
- The first private loop created untracked `.stardock/` files until `.gitignore` was updated; keep runtime loop state ignored by default.
- New managed loops now use per-run folders under `.stardock/runs/` so task files and state files for different runs are easy to distinguish.
- `governEvery: 1` originally created an automatic governor request for the same iteration immediately after a manual governor request was answered. This was noisy and is now suppressed by keeping governor requests to one per iteration.
- `stardock_state` now gives agents a compact read-only state/list surface so dogfood runs do not require direct reads of ignored `.stardock/` files.
- `/stardock view`, `/stardock timeline`, and `stardock_state` overview/timeline views provide the first operational "what is happening" visualization for a run.
- The active-run widget now provides an at-a-glance companion with loop identity, mode/status/iteration, recursive attempt progress, outside request count, latest attempt, and latest governor steer.
- Initial schema v3 ledger state now stores `criterionLedger` and `verificationArtifacts`; `stardock_ledger` can list/upsert criteria and record compact artifact refs, and `stardock_state` reports criteria/artifact progress without reading `.stardock/` files.
- Initial IterationBrief v1 state now stores manual `briefs` and `currentBriefId`; `stardock_brief` can list/upsert/activate/clear/complete briefs, and active briefs add bounded selected context to prompts without replaying the full ledger or long artifacts.

## Updated design direction: context routing, not prompt replay

Dogfooding showed that repeating the canonical task or plan each iteration is often the wrong context shape. The canonical plan can be larger than what the next worker needs and can distract the agent from the specific next move.

Future Stardock work should treat the canonical plan and task file as durable source material, not as the default iteration prompt. Each iteration should receive a **context packet** selected for that attempt:

1. **Specific job** — the one bounded action to perform now.
2. **Acceptance criteria** — what makes this attempt complete.
2. **Required context** — only the relevant plan excerpts, files, decisions, and constraints.
3. **Future-preserving constraints** — invariants, compatibility notes, and what not to overbuild.
4. **Output contract** — attempt report, changed files, validation evidence, risks, and suggested next move.

The governor should own context selection. Instead of the loop driver blindly queuing the same task content, the target architecture is:

```text
durable plan + durable loop state
        ↓
governor selects next move + minimal context packet
        ↓
worker/subagent performs one bounded attempt
        ↓
structured report + artifacts
        ↓
governor updates state and chooses the next packet
```

The governor also has a one-shot/compaction problem. Do not assume the governor keeps infinite chat context. Preserve governor understanding in durable state and outsource bounded work to workers/subagents when useful.

Future state shape to consider:

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
```

Subagents should help the governor avoid “driving down the ditch”: the implementer does one bounded attempt, while the governor owns direction, stop/pivot/continue decisions, and context routing. The parent/governor should not automatically reread every file a worker touched; it should consume structured worker reports and inspect only high-risk, ambiguous, failed, or public-contract-changing areas.

## Verification-led context routing

The [Ralphable methodology article](https://ralphable.com/blog/ralph-loop-methodology) reinforces one useful design point: objective pass/fail criteria should be explicit, durable, and tied to evidence. Treat the article as design input, not as authority for marketing claims or exact implementation choices.

The missing bridge between the canonical plan and a minimal iteration prompt is a **criterion ledger**. The canonical plan should be distilled into criteria once, then each `IterationBrief` should reference the criteria relevant to the next bounded attempt.

Target flow:

```text
canonical plan
→ criterion ledger
→ governor selects criterion IDs + required context
→ worker executes bounded brief
→ worker reports evidence, failures, and diagnoses
→ ledger updates
→ governor chooses next brief or final verification
```

Future state shape to consider:

```ts
interface Criterion {
  id: string;
  taskId?: string;
  sourceRef?: string;
  description: string;
  passCondition: string;
  testMethod?: string;
  status: "pending" | "passed" | "failed" | "skipped" | "blocked";
  evidence?: string;
  redEvidence?: string;
  greenEvidence?: string;
  lastCheckedAt?: string;
}

interface CriterionLedger {
  criteria: Criterion[];
  requirementTrace: Array<{ requirement: string; criterionIds: string[] }>;
}

interface BaselineValidation {
  command: string;
  result: "passed" | "failed" | "skipped" | "blocked";
  summary: string;
  evidencePath?: string;
}

interface VerificationArtifact {
  kind: "test" | "smoke" | "curl" | "browser" | "screenshot" | "walkthrough" | "benchmark";
  command?: string;
  path?: string;
  summary: string;
  criterionIds?: string[];
}

interface EvidenceJournal {
  path: string;
  summary: string;
  artifactIds: string[];
}

interface FailureDiagnosis {
  criterionId: string;
  observedFailure: string;
  likelyCause: string;
  fixApplied?: string;
  retestEvidence?: string;
}

interface BreakoutPackage {
  blockedCriterionIds: string[];
  attemptsTried: string[];
  lastErrors: string[];
  suspectedRootCauses: string[];
  requestedDecision: string;
  resumeCriteria: string[];
}

interface FinalVerificationReport {
  criteriaSummary: {
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
  validationCommands: string[];
  artifacts: VerificationArtifact[];
  integrationEvidence?: string;
  unresolvedGaps: string[];
  completionRationale: string;
}

interface CompoundLearning {
  reusablePrompt?: string;
  reusableValidation?: string;
  skillUpdateCandidate?: string;
  toolImprovementCandidate?: string;
  projectConventionLearned?: string;
}

interface HandoffExplanation {
  path: string;
  scope: string;
  intendedReader: "maintainer" | "reviewer" | "operator";
  summary: string;
}
```

The governor should use iteration metrics as drift signals:

- same criterion fails repeatedly → split the task, challenge the criterion, or request outside help;
- many attempts with no criterion status movement → likely scaffolding drift or wrong lane;
- repeated fixes without retesting → force an evaluation step before more implementation;
- final completion should require a compact `FinalVerificationReport`, not only a completion marker.

Requirement traceability should stay compact:

```text
original requirement → criterion → attempt/report → evidence
```

Quality profiles can be a later option, not a default. If added, they should raise verification standards deliberately, for example `functional` → `integration` → `production` → `polish`, instead of encouraging premature polish on discardable work.

The [Agentic Engineering Patterns guide](https://simonwillison.net/guides/agentic-engineering-patterns/) adds several verification and context-management practices that fit this design:

- **Baseline validation**: when a validation command exists, first run the relevant tests/checks before changes so the loop knows the starting state and primes the worker with project-native validation.
- **Red/green evidence**: criteria backed by new tests should record that the test failed before implementation and passed after implementation.
- **Manual testing artifacts**: smoke commands, `curl` checks, browser automation, screenshots, and benchmarks count as evidence when linked to criteria.
- **Evidence journals**: long command logs, screenshots, and walkthroughs should live as artifact files with compact summaries in state/prompt context.
- **Compound learning**: finalization can optionally propose reusable prompt, validation, skill, tool, or project-convention updates discovered during the loop.
- **Cognitive debt gates**: large or complex agent-generated changes may require a walkthrough or maintainer-facing explanation before final completion.

## Oversight: who watches the governor

The governor can drift too. Add a bounded **Auditor** / **Oversight Reviewer** role that reviews the control loop, not the implementation details. The auditor should be occasional, evidence-led, non-executing, and unable to silently mutate state.

The role split becomes:

```text
Implementer: performs bounded work
Governor: chooses direction, criteria, and context
Auditor: checks whether governor direction remains aligned, evidenced, and safe
User: ultimate authority for scope/value judgments and overrides
```

Auditor reviews should run only at checkpoints:

- every N governor decisions, not every iteration;
- before final completion;
- before relaxing/deleting criteria or changing scope;
- before high-risk automation such as editing subagents, candidate patch application, or evolve mode;
- when drift signals appear, such as repeated no-progress decisions, omitted context, or repeated worker duplication.

Future state shape to consider:

```ts
interface AuditorFinding {
  severity: "info" | "warning" | "blocker";
  summary: string;
  evidence: string;
  recommendation: string;
}

interface AuditorReview {
  id: string;
  reviewedAt: string;
  verdict:
    | "aligned"
    | "minor_concerns"
    | "direction_drift"
    | "evidence_gap"
    | "scope_creep"
    | "premature_completion"
    | "needs_user_decision";
  findings: AuditorFinding[];
  requiredGovernorAction?: string;
  forbiddenNextMoves?: string[];
  criteriaToRevisit?: string[];
  userQuestions?: string[];
}
```

Auditor blocker findings should constrain the next governor decision. The governor must either comply, record a concrete rejection rationale, or ask the user for an override.

Two-key decisions should require governor plus auditor agreement, or explicit user approval:

- complete with unresolved/skipped criteria;
- relax, delete, or reinterpret criteria;
- switch from advisory subagents to editing subagents;
- apply candidate patches automatically;
- enter evolve/candidate execution mode;
- perform destructive operations;
- declare a large/complex change done without walkthrough/evidence.

First implementation should be data-only: create an `auditor_review` outside request and ready-to-copy payload, then record the answer like other outside requests. Do not add always-on auditor loops or direct model calls inside the extension.

## Remaining future work summary

The practical implementation path is complete through bounded recursive/governor workflow. Remaining work is design-gated and should be driven by dogfood evidence:

1. **Verification-led context routing**
   - add a `CriterionLedger` after dogfooding confirms the right criterion granularity;
   - route `criterionIds`, pass conditions, and test methods into `IterationBrief` instead of replaying the full plan;
   - record baseline validation and red/green evidence when a criterion is backed by new tests;
   - update criterion status from worker evidence, verification artifacts, and failure diagnoses.
2. **Context packet routing**
   - add `GovernorState` and `IterationBrief` only after manual governor/payload workflows show what context is repeatedly needed;
   - make prompts brief-by-default and source the canonical plan selectively;
   - keep large artifacts referenced, not pasted.
3. **Auditor oversight**
   - add `auditor_review` requests and ready-to-copy auditor payloads;
   - run auditor reviews at bounded checkpoints, pre-completion, scope changes, automation gates, and drift signals;
   - require blocker findings to constrain or be explicitly rejected by the next governor decision;
   - use two-key rules for unresolved completion, criteria relaxation, editing subagents, evolve execution, and destructive operations.
4. **Worker/subagent handoff quality**
   - define a durable `WorkerReport` contract with evaluated criteria, validation evidence, verification artifact refs, and failure diagnoses;
   - add selective parent review policy so the governor does not duplicate worker work;
   - implement advisory-only subagent flow before any editing flow.
5. **Completion, breakout, and learning gates**
   - add `FinalVerificationReport` before making completion fully criteria-aware;
   - add `BreakoutPackage` for repeated failures, blocked criteria, or loops with no criterion movement;
   - add optional compound-learning proposals and cognitive-debt walkthrough requirements for large/complex changes;
   - keep quality-profile escalation optional and explicit.
5. **Subagent-driven recursive mode**
   - use `.pi/plans/stardock-subagent-recursive-mode.md` as the design gate;
   - start with exploration and test-runner subagents before implementer subagents;
   - do not spawn subagents directly from the extension until lifecycle, cancellation, result capture, and edit ownership are safe.
6. **Evolve mode**
   - use `.pi/plans/stardock-evolve-mode.md` as the design gate;
   - implement only after evaluator contracts, isolation, archive bounds, prompt bounds, criterion/evidence handling, artifact handling, auditor gate handling, and dogfood evidence are available.

## Architecture decision

### Data/state shape

Keep one top-level loop state with a mode-specific nested payload:

```ts
type LoopMode = "checklist" | "recursive" | "evolve";

type LoopStatus = "active" | "paused" | "completed";

interface LoopState {
  schemaVersion: 3;
  name: string;
  taskFile: string;
  mode: LoopMode;
  iteration: number;
  maxIterations: number;
  itemsPerIteration: number;
  reflectEvery: number;
  reflectInstructions: string;
  active: boolean;
  status: LoopStatus;
  startedAt: string;
  completedAt?: string;
  lastReflectionAt: number;
  modeState: ChecklistModeState | RecursiveModeState | EvolveModeState;
  outsideRequests: OutsideRequest[];
  criterionLedger: CriterionLedger;
  verificationArtifacts: VerificationArtifact[];
  briefs: IterationBrief[];
  currentBriefId?: string;
}
```

Private Stardock schema rule: current `.stardock/runs/<name>/state.json` state is schema-versioned and mode-aware. Missing mode metadata in private state can be treated as checklist state for local resilience, and legacy flat `.stardock/<name>.state.json` files remain readable enough to resume and rewrite into the run-folder layout. `.ralph/` compatibility is not required. Add a one-shot importer only if active local state is worth preserving.

Future schema revisions may add `governorState`, auditor reviews, baseline validation, compound-learning proposals, handoff explanations, final verification records, and stronger artifact/archive policy. Keep them additive and migratable; older private checklist/recursive loops must remain valid with empty synthesized ledgers/artifact/brief/audit lists.

### Mode interface

Use a small internal mode interface. The extension commands/tools stay stable while mode implementations own prompt and state semantics.

```ts
interface LoopModeHandler<TModeState> {
  mode: LoopMode;
  createInitialState(input): TModeState;
  buildPrompt(loop: LoopState, taskContent: string, reason: PromptReason): string;
  onIterationDone(loop: LoopState, ctx: ExtensionContext): IterationDecision;
  summarize(loop: LoopState): string[];
}
```

Current implementation distinguishes normal iteration and reflection. Future prompt-reason work should add outside-research-returned, max-iteration warning, and manual resume only when those paths need materially different prompts.

### Outside research/request shape

Represent outside help as a durable request in state before wiring it to subagents. This keeps the loop engine deterministic and inspectable.

There are four distinct outside/worker roles for recursive and evolve loops:

1. **Governor** — owns loop direction. Reviews trajectory and decides whether effort is being spent well, has narrowed too far, is stuck in scaffolding/setup work, or needs a hard steer toward measurement and candidate changes.
2. **Auditor** — watches the governor at bounded checkpoints. Reviews objective alignment, criteria integrity, evidence sufficiency, context routing, scope drift, and automation safety.
3. **Implementer** — owns one bounded attempt. It should not own the overall decision to keep pursuing its current lane.
4. **Researcher** — supplies new ideas, mutations, prior art, examples, benchmarks, or failure explanations when the governor requests more options.

The governor is not just a normal reflection prompt. It should have authority to emit steering decisions that the next iteration must follow unless the main agent records a concrete reason to reject them. The auditor is not a second governor; it issues bounded findings that the governor must address or escalate to the user.

Long-term recursive/evolve loops should be capable of this manager/worker cadence:

```text
Governor chooses next move
→ Implementer performs one bounded attempt
→ validation/evaluation runs
→ Implementer records attempt report
→ Governor reviews evidence and either continues, pivots, requests research, stops, or asks the user
→ Auditor occasionally reviews governor direction and gates high-risk moves
```

For the first implementation passes, keep this as state and prompt structure. Do not require the extension to spawn subagents directly.

```ts
interface OutsideRequest {
  id: string;
  kind: "ideas" | "research" | "mutation_suggestions" | "failure_analysis" | "governor_review" | "auditor_review";
  status: "requested" | "in_progress" | "answered" | "dismissed";
  requestedAt: string;
  requestedByIteration: number;
  trigger:
    | "every_n_iterations"
    | "out_of_ideas"
    | "manual"
    | "stagnation"
    | "scaffolding_drift"
    | "low_value_lane"
    | "periodic_audit"
    | "pre_completion"
    | "scope_change"
    | "automation_gate";
  prompt: string;
  answer?: string;
  decision?: GovernorDecision;
  audit?: AuditorReview;
  consumedAt?: string;
}

interface GovernorDecision {
  verdict: "continue" | "pivot" | "stop" | "measure" | "exploit_scaffold" | "ask_user";
  rationale: string;
  requiredNextMove?: string;
  forbiddenNextMoves?: string[];
  evidenceGaps?: string[];
}
```

First pass can create and display requests. Later passes can execute them with `subagent`, `web_search`, or dedicated research tools.

### Performance shape

Scaling variables:
- number of loops in the Stardock state directory
- task file size
- number of attempts/candidates in mode state
- number and size of outside request answers
- number and size of auditor reviews and findings
- evaluator command output size for future recursive/evolve validation

Bounds:
- list/status reads only bounded Stardock state files and archived state files.
- mode summaries cap rendered attempt/candidate/request/audit rows.
- recursive/evolve logs store summaries in state and detailed artifacts in separate files when content grows.
- evaluator outputs in future modes must have timeouts and byte caps before being inserted into prompts.

## Mode semantics

### Orchestration model by mode

- `checklist`: in-session single-agent loop by default. The main agent can keep working through a finite checklist without governor overhead.
- `recursive`: governed loop. Initially the main agent may still perform implementation, but the state model and prompts should treat each iteration as a bounded implementer attempt that is subject to governor review and occasional auditor oversight.
- `evolve`: manager/worker loop. Candidate generation, evaluation, archive management, and research injection should eventually be separated, likely with subagents/worktrees, but only after recursive mode has been dogfooded and auditor gates for high-risk automation are defined.

### `checklist` mode

Purpose: finite known work.

Behavior:
- Default mode for `stardock_start`/`sd_start` calls.
- Current prompt remains materially the same.
- Current task file markdown remains valid.
- `stardock_done`/`sd_done` increments iteration and queues the next checklist prompt.
- Completion marker completes the loop.

Acceptance:
- Existing tests still pass.
- Local legacy `.ralph/*.state.json` files may be imported or ignored; compatibility is not required.
- Current private `.stardock/runs/<name>/state.json` files remain valid across additive schema revisions.
- Legacy flat `.stardock/*.state.json` files may be read and rewritten into `.stardock/runs/<name>/state.json` when touched.

### `recursive` mode

Purpose: bounded open-ended search such as debugging, performance tuning, implementation strategy search, or idea exhaustion.

Setup fields:

```ts
interface RecursiveSetup {
  objective: string;
  baseline?: string;
  validationCommand?: string;
  resetPolicy: "manual" | "revert_failed_attempts" | "keep_best_only";
  stopWhen: Array<"target_reached" | "idea_exhaustion" | "max_failed_attempts" | "max_iterations" | "user_decision">;
  maxFailedAttempts?: number;
  outsideHelp?: OutsideHelpPolicy;
}
```

Attempt state:

```ts
interface RecursiveAttempt {
  id: string;
  iteration: number;
  hypothesis: string;
  actionSummary?: string;
  validation?: string;
  result?: "improved" | "neutral" | "worse" | "invalid" | "blocked";
  kept?: boolean;
  evidence?: string;
  followupIdeas?: string[];
}
```

Prompt behavior:
- Treat the current iteration as one bounded implementer attempt, not an open-ended lane.
- Ask the agent to propose or choose one hypothesis.
- Make one bounded attempt.
- Run or describe validation according to `validationCommand`.
- Record result in the task file and/or mode state.
- Decide keep/reset according to reset policy.
- Call `stardock_done`/`sd_done` if more plausible ideas remain.
- Output completion marker only when target reached or ideas are exhausted.

Outside help trigger:
- Every N iterations if configured.
- When the agent marks result as `blocked` or says it is out of ideas.
- When failed/neutral attempt count reaches a configured threshold.
- When the attempt log shows repeated scaffolding/setup work without using the scaffold to make a measured candidate change.
- When several attempts stay within the same easy lane without improving the objective.

Governor checkpoint behavior:
- Summarize the last N attempts, current best evidence, scaffolding created, and unused capabilities.
- Ask whether the next move should continue the lane, exploit the scaffold, pivot to a different optimization family, measure first, request researcher input, stop, or ask the user.
- If the governor emits `requiredNextMove`, include it prominently in the next iteration prompt.
- Require the main loop to either follow the steer or record why it is rejecting it.
- If the governor emits `request_research`, create a researcher `OutsideRequest` with a targeted prompt rather than letting the implementer brainstorm indefinitely.

Auditor checkpoint behavior:
- Review recent governor decisions, iteration briefs, criterion movement, evidence quality, and budget use.
- Trigger before final completion, scope/criteria changes, high-risk automation, or repeated no-progress governor decisions.
- If the auditor emits blocker findings, the next governor decision must comply, explicitly reject with rationale, or ask the user for an override.

### `evolve` mode

Purpose: metric-driven candidate search inspired by OpenEvolve.

Do not implement initially. Design state now so recursive attempt data can upgrade into candidate archives later.

Future setup fields:

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
}
```

Future candidate state:

```ts
interface Candidate {
  id: string;
  parentId?: string;
  iteration: number;
  summary: string;
  patchFile?: string;
  metrics: Record<string, number | string>;
  primaryScore?: number;
  status: "accepted" | "rejected" | "invalid" | "best";
}
```

OpenEvolve ideas to map later:
- evaluator returns metrics
- archive preserves best candidates
- diversity dimensions can become optional labels/metrics
- early stopping uses patience and threshold
- islands/parallelism are future work, likely via worktrees/subagents

## Implementation plan status

Completed implementation is intentionally compacted here; use commit history and tests for detail.

| Stage | Status | Commit(s) / notes |
| --- | --- | --- |
| State migration + checklist handler | Done | `6eccd8e`; v1 state migrates to checklist schema v2. |
| Mode parameter + validation | Done | `251732e`; `checklist` default, unsupported modes fail cleanly. |
| Recursive setup + prompt | Done | `a8fe4f1`; objective/setup state, bounded-attempt prompt, attempt placeholders. |
| Outside request queue + governor decisions | Done | `3088421`; data-only requests and answer recording. |
| Structured attempt reports | Done | `945b100`; now surfaced as `stardock_attempt_report` for hypothesis/action/validation/result/evidence. |
| Request payloads/templates | Done | `bf22925`; ready-to-copy governor/researcher payloads. |
| Trigger mechanics | Done | `a233c34`; `governEvery`, stagnation, and scaffolding-drift request creation. |
| Manual governor helper | Done | `a66512c`; now surfaced as `stardock_govern` to create/reuse a durable governor request and payload. |
| Future automation design gates | Done | `417f768`; subagent and evolve plans written. |
| Private Stardock extension shell | Done | `fceb41d`; extension moved to `agent/extensions/private/stardock/`; public Ralph path removed; clean `stardock_*`, `/stardock`, and `.stardock/` surface implemented. |
| Per-run Stardock storage | Done | Managed runs use `.stardock/runs/<name>/task.md` and `state.json`; archives use `.stardock/archive/<name>/`. |
| Recursive dogfood stabilization | Done | Governor requests dedupe by iteration; `stardock_state` lists/inspects loop state without reading runtime files directly. |
| Operational run visualization | Done | `/stardock view`, `/stardock timeline`, and `stardock_state` overview/timeline views show status, progress, latest governor decision, and event flow. |

### Next implementation candidates

Do not restart the completed implementation path. Future implementation should begin with one of these design-gated slices:

1. **Criterion ledger expansion**
   - Initial additive state and `stardock_ledger` update/list support exists for criteria, pass conditions, test methods, status, compact evidence, optional red/green evidence, requirement traces, and compact artifact refs.
   - Add a plan/task-file distillation path that can create or update criteria without replacing the canonical plan.
   - Add baseline validation records and stronger criteria review/update policy once dogfooding shows the right granularity.
2. **Verification artifact expansion**
   - Initial artifact refs exist for tests, smoke commands, `curl`, browser/screenshot checks, walkthroughs, benchmarks, logs, and other refs.
   - Keep long logs/screenshots outside state and include only compact summaries in prompts.
   - Add final-report support for artifact lists and unresolved validation gaps.
3. **Criteria-aware context packet expansion**
   - Initial manual IterationBrief v1 state and `stardock_brief` update/list/activation support exists.
   - Dogfood manually selected briefs before adding `GovernorState`; keep prompts normal when no active brief exists.
   - Later, add governor-selected brief creation and stronger policy for when a brief supersedes full task replay.
   - Continue keeping selected `criterionIds`, required context, and verification requirements bounded; keep large artifacts referenced.
4. **Auditor oversight workflow**
   - Add `auditor_review` request creation and ready-to-copy auditor payloads.
   - Add trigger handling for periodic review, pre-completion, scope/criteria changes, automation gates, and drift signals.
   - Record auditor findings and require blocker findings to constrain, be explicitly rejected by, or escalate the next governor decision.
5. **Worker report / selective review workflow**
   - Define `WorkerReport` state and payload expectations, including evaluated criteria, artifact refs, and failure diagnoses.
   - Add request payload guidance telling workers which files/symbols the parent should inspect and why.
   - Add a policy that parent/governor reads touched files only for risk, ambiguity, failed validation, public contract changes, or explicit review hints.
6. **Breakout, final verification, and compound learning reports**
   - Add `BreakoutPackage` for repeated criterion failures, blocked criteria, or no criterion movement.
   - Add `FinalVerificationReport` so completion summarizes criteria status, validation commands, artifacts, integration evidence, and unresolved gaps.
   - Add optional compound-learning proposals and cognitive-debt handoff explanations.
7. **Advisory subagent workflow**
   - Start with exploration and test-runner subagents if a safe extension/subagent API exists.
   - Do not apply edits automatically.
   - Persist worker run payload, result, failure, artifact refs, and summaries.
8. **Evolve mode**
   - Start only after `.pi/plans/stardock-evolve-mode.md` gates are satisfied.
   - Require evaluator timeout/output caps, archive caps, candidate summary bounds, criterion/evidence/artifact handling, auditor gates, and isolation choice before implementation.

### Completion boundary

The original mode-aware/recursive implementation path is complete up to the safe boundary and has been moved under private Stardock naming. Direct subagent execution and evolve candidate execution are intentionally not implemented because they require design approval and safety proof points.

## Validation strategy

Per commit:
- `npm run typecheck --prefix agent/extensions`
- `npm test --prefix agent/extensions -- private/stardock/index.test.ts`
- `git diff --check -- agent/extensions/private/stardock`

After behavior changes:
- `./link-into-pi-agent.sh`
- reload/restart Pi
- smoke checklist loop:
  - `stardock_start`/`sd_start` queues prompt
  - completion marker completes without extension error
- smoke recursive loop after recursive/outside-request changes:
  - starts with mode state
  - queues recursive prompt
  - creates/preserves attempt log
  - creates outside/governor requests when configured
  - records outside answers or governor decisions
  - includes latest steer in the next prompt
  - completion marker completes without extension error
- smoke criteria-aware loop after criterion-led changes:
  - distills or records criteria without losing the canonical plan
  - records baseline validation and red/green evidence when available
  - routes only selected criteria into the next prompt
  - stores long logs/screenshots as artifact refs, not prompt text
  - updates criterion status from evidence
  - produces breakout/final verification reports when triggered
- smoke auditor workflow after oversight changes:
  - creates `auditor_review` requests at configured gates
  - records auditor findings without mutating criteria or implementation state directly
  - includes blocker findings in the next governor prompt
  - requires explicit governor response or user escalation before gated moves

## Risks and mitigations

- Risk: losing useful local legacy `.ralph` state during extraction.
  - Mitigation: treat old loop state as disposable by default; add a one-shot importer only if there is active state worth preserving.
- Risk: prompt bloat from attempt/candidate logs.
  - Mitigation: cap prompt summaries and move large artifacts to separate files.
- Risk: criteria ledger creates false precision or duplicates the plan.
  - Mitigation: keep criteria binary/testable, preserve source refs, and route criterion IDs plus selected context instead of copying the full plan.
- Risk: evidence artifacts grow without bound or become unreadable.
  - Mitigation: store large logs/screenshots outside state, cap summaries, and require final reports to name only decision-relevant artifacts.
- Risk: auditor reviews create infinite-regress governance or too much overhead.
  - Mitigation: keep the auditor bounded, occasional, non-executing, and focused on control-loop evidence; do not add auditor-of-auditor behavior.
- Risk: outside research creates distracting work or loops forever.
  - Mitigation: make outside requests data-only first, with explicit budgets/triggers.
- Risk: evolve mode mutates code unsafely.
  - Mitigation: require evaluator command, timeouts, archive caps, and later worktree/patch isolation before automatic candidate search.
- Risk: mode setup becomes too complex for natural language use.
  - Mitigation: keep `checklist` default simple; add mode-specific setup helpers only after user-facing examples settle.

## Execution recommendation

The initial mode-aware/recursive implementation path is complete. Next execution should not restart at task 1. Use this order instead:

1. Dogfood recursive mode with the current attempt-report/governor tools on one or two real debugging or optimization tasks.
2. Prototype the criterion ledger and baseline/red-green evidence only after dogfooding confirms the right granularity.
3. Add verification artifacts and compact final reports.
4. Add auditor review requests/payloads before adding any direct subagent automation.
5. Add exploration/test-runner subagents before implementer subagents.
6. Treat editing subagents and `evolve` mode as follow-up projects with separate safety gates and auditor checkpoints.
