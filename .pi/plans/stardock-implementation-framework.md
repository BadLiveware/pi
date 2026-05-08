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

Last updated: 2026-05-08.

Checklist mode has now been dogfooded enough for bounded implementation work to be treated as a stable foundation. The next target is subagent readiness: preserve parent/governor accountability, make baseline evidence explicit before worker attempts, define selective parent review expectations, and require auditor/user gates for high-risk automation before direct provider execution.

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

- Subagent-readiness boundary:
  - provider-neutral advisory handoffs and WorkerReports exist, but Stardock still does not execute providers directly;
  - future evolve setup/candidate/archive state is typed and migrates safely, but evolve startup remains disabled;
  - bounded checklist mode has been dogfooded as working for real implementation loops.
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
- Initial IterationBrief v1 state now stores `briefs` and `currentBriefId`; `stardock_brief` can list/upsert/activate/clear/complete briefs, and active briefs add bounded selected context to prompts without replaying the full ledger or long artifacts.
- Agent-operability refinements reduce common serial workflows: `stardock_ledger` supports batch criteria/artifact updates and opt-in state/overview details, while `stardock_brief` can create-and-activate a brief plus return optional state or prompt preview details in one call.
- Governor-selected brief v1 is explicit metadata, not automation: `stardock_brief` can record `source: "governor"` and an optional governor-review `requestId`, while activation still requires `activate: true` or a separate `activate` action.
- Brief lifecycle policy v1 is explicit cleanup, not hidden automation: `stardock_done` keeps active briefs by default and accepts opt-in `briefLifecycle: "complete" | "clear"` when an iteration should finish or deactivate the current brief.
- ClickHouse PromQL upstreaming dogfood (`clickhouse-native-promql-upstreaming`, 16 checklist iterations, 17 criteria, 89 artifacts, 17 briefs, 7 final reports, 1 accepted blocked PR15 criterion) validated briefs/ledger/final reports for long implementation work and drove follow-up hardening: evidence/status enum aliases, accepted-deferred blocker completion policy, one-call brief lifecycle prompts, and task-checklist/ledger drift reporting.

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

Current and candidate future state shape:

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
  source: "manual" | "governor";
  requestId?: string;
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

Current and candidate future evidence shape:

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
  id: string;
  status: "draft" | "passed" | "failed" | "partial";
  summary: string;
  criterionIds: string[];
  artifactIds: string[];
  validation: Array<{ command?: string; result: "passed" | "failed" | "skipped"; summary: string; artifactIds?: string[] }>;
  unresolvedGaps: string[];
  compatibilityNotes: string[];
  securityNotes: string[];
  performanceNotes: string[];
  createdAt: string;
  updatedAt: string;
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

Current and candidate future auditor shape:

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

Current implementation is data-only: `stardock_auditor` creates ready-to-copy auditor payloads and records compact review results, while `stardock_policy({ action: "auditor" })` recommends when oversight is warranted. Do not add always-on auditor loops, direct model calls, or enforcing gates inside the extension until blocker-handling policy is explicit.

## Remaining future work summary

The practical implementation path is complete through the safe manual/data-only framework boundary. Stardock now has durable state, checklist and recursive modes, governor/outside request workflows, criteria, artifacts, iteration briefs, final reports, auditor reviews, advisory handoffs, breakout packages, worker reports, read-only policy recommendations, batch evidence writes, reserved evolve state, and Pi-free app orchestration for the main write tools.

Remaining work is design-gated and should be driven by dogfood evidence. Stardock is beginning to move from loop-first checklist prompting toward a state-machine-first workflow: a derived read-only workflow status now summarizes whether a run is ready for work, needs parent review, needs auditor review, needs a breakout decision, is ready for final verification, is blocked, or is completed. Immediate subagent-readiness work should happen before direct provider execution:

1. **Criteria and evidence policy hardening**
   - Initial `CriterionLedger`, verification artifact refs, task-file criterion distillation, red/green evidence fields, requirement traces, and compact artifact summaries exist.
   - Baseline validation records now exist as first-class pre-change evidence linked to criteria and artifacts.
   - Still needed: stronger criteria review/update policy and policy for when worker evidence can update criterion status without manual parent review.
2. **Context packet routing policy**
   - Initial `IterationBrief` state, prompt routing, governor-sourced brief metadata, lifecycle cleanup, and bounded criterion/context inclusion exist.
   - Still needed: stronger policy for when a governor-sourced brief supersedes full task replay across multiple attempts, and optional durable `GovernorState` if dogfooding shows that decisions need more memory than outside requests/briefs currently provide.
3. **Auditor oversight workflow**
   - Initial manual/data-only `stardock_auditor` payload/list/record support exists, and `stardock_policy({ action: "auditor" })` recommends oversight from current evidence.
   - Initial read-only `stardock_policy({ action: "auditorGate" })` now surfaces blocker follow-ups and high-risk automation/completion gate points that should be complied with, explicitly rejected with rationale, or escalated to the user.
   - Still needed: automatic trigger creation for periodic review, pre-completion, scope/criteria changes, automation gates, and drift signals.
4. **Worker/subagent handoff quality**
   - Initial provider-neutral `stardock_handoff` and `stardock_worker_report` support exists for advisory payloads/results, evaluated criteria, artifact refs, changed files, validation, risks, questions, suggested next moves, and review hints.
   - Initial read-only `stardock_policy({ action: "parentReview" })` now recommends selective parent/governor review for risky WorkerReports, changed-file hints, non-passing validation, and implementer handoffs.
   - Brief-scoped `stardock_brief({ action: "payload" })` and parent-owned `stardock_advisory_adapter` payloads now cover safe explorer/test-runner invocation handoffs without Stardock executing providers.
   - Still needed: direct provider execution adapter design; keep this advisory-only before any editing flow.
5. **Completion, breakout, and learning gates**
   - Initial manual/data-only `FinalVerificationReport` and `BreakoutPackage` support exists, and `stardock_policy({ action: "completion" | "breakout" })` recommends final reports, auditor reviews, or breakout packages without enforcing hidden gates.
   - Initial derived workflow status surfaces final-verification readiness, breakout decisions, parent review, auditor review, blocked, and completed states in `stardock_state`, overview/list text, prompts, transition notifications, and the active widget without storing another mutable source of truth.
   - Still needed: dogfood transition-noise and prompt-gate behavior, policy for when completion should require or recommend a final report/auditor review/breakout package, optional compound-learning proposals, and cognitive-debt walkthrough requirements for large or complex changes.
6. **Subagent-driven recursive mode**
   - Use `.pi/plans/stardock-subagent-recursive-mode.md` as the design gate.
   - Start with exploration and test-runner providers before implementer providers.
   - Do not spawn subagents directly from the extension until lifecycle, cancellation, result capture, edit ownership, and parent review policy are safe.
7. **Evolve mode**
   - Use `.pi/plans/stardock-evolve-mode.md` as the design gate.
   - Implement only after evaluator contracts, isolation, archive bounds, prompt bounds, criterion/evidence handling, artifact handling, auditor gate handling, and dogfood evidence are available.

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
  finalVerificationReports: FinalVerificationReport[];
  auditorReviews: AuditorReview[];
  advisoryHandoffs: AdvisoryHandoff[];
  breakoutPackages: BreakoutPackage[];
  workerReports: WorkerReport[];
}
```

Private Stardock schema rule: current `.stardock/runs/<name>/state.json` state is schema-versioned and mode-aware. Missing mode metadata in private state can be treated as checklist state for local resilience, and legacy flat `.stardock/<name>.state.json` files remain readable enough to resume and rewrite into the run-folder layout. `.ralph/` compatibility is not required. Add a one-shot importer only if active local state is worth preserving.

Future schema revisions may add `governorState`, baseline validation, compound-learning proposals, handoff explanations, and stronger artifact/archive policy. Keep them additive and migratable; older private checklist/recursive loops must remain valid with empty synthesized evidence and governance lists.

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
| Criterion ledger and artifacts | Done | `stardock_ledger` lists/upserts criteria, records compact verification artifact refs, supports batch writes, and can distill starter criteria from task-file checklist or goal bullets without rewriting the task. |
| Iteration briefs | Done | `stardock_brief` manages manual/governor-sourced context packets, activation, lifecycle cleanup, bounded prompt routing, batch upsert/complete, and prompt preview details. |
| Final reports | Done | `stardock_final_report` records compact manual final verification reports with criteria, artifacts, validation, unresolved gaps, and risk notes. |
| Auditor reviews | Done | `stardock_auditor` builds ready-to-copy manual auditor payloads and records compact auditor review results; v1 is data-only and non-executing. |
| Advisory handoffs | Done | `stardock_handoff` builds provider-neutral handoff payloads and records compact returned results without binding Stardock to provider execution. |
| Breakout packages | Done | `stardock_breakout` builds and records manual decision packages for blocked/stuck loops; v1 is data-only and non-enforcing. |
| Governance policies | Done | `stardock_policy` provides read-only advisory recommendations for completion, auditor, and breakout checks without mutating state or enforcing gates. |
| Worker reports | Done | `stardock_worker_report` builds provider-neutral report contracts and records compact worker results for selective parent/governor review. |
| Followup and batch ergonomics | Done | Mutating evidence tools support batch-first inputs; Stardock-local `followupTool` attaches approved read-only followups while rejecting unknown or mutating nested actions. |
| App-layer extraction | Done | Main evidence-writing tools now route mutation orchestration through Pi-free `src/app/*-tool.ts` modules; Pi-facing files remain registration/schema/state-store/UI adapters. |

### Next implementation candidates

Do not restart the completed implementation path. Future implementation should begin with one of these design-gated slices:

1. **Criterion ledger expansion**
   - Initial additive state and `stardock_ledger` update/list support exists for criteria, pass conditions, test methods, status, compact evidence, optional red/green evidence, requirement traces, compact artifact refs, and baseline validation records.
   - Initial task-file distillation exists through `stardock_ledger({ action: "distillTaskCriteria" })`; it derives starter criteria from checklist items, or goal/requirement bullets when no checklist exists, without replacing the canonical task file.
   - Add stronger criteria review/update policy once dogfooding shows the right granularity.
2. **Verification artifact expansion**
   - Initial artifact refs exist for tests, smoke commands, `curl`, browser/screenshot checks, walkthroughs, benchmarks, logs, and other refs.
   - Keep long logs/screenshots outside state and include only compact summaries in prompts.
   - Add final-report support for artifact lists and unresolved validation gaps.
3. **Criteria-aware context packet expansion**
   - Initial IterationBrief v1 state and `stardock_brief` update/list/activation support exists.
   - Manual brief dogfood found the data shape usable; agent-operability refinement added `activate: true`, optional `includeState`, and capped `includePromptPreview` for create-and-use workflows.
   - Initial local `followupTool` support lets mutating Stardock tools attach read-only `stardock_state` or `stardock_policy` output after a mutation; unknown or mutating followups are rejected instead of executed. Keep existing `include*` flags as compatibility sugar while preferring `followupTool` for new post-action context.
   - Governor-selected brief v1 exists as explicit `source: "governor"` plus optional `requestId` metadata linked to a governor-review outside request; no hidden model call, auto-distillation, or silent activation is performed.
   - Brief lifecycle policy v1 adds opt-in `stardock_done` cleanup with `briefLifecycle: "complete" | "clear"`, while default behavior keeps the active brief.
   - Later, add stronger policy or reports for when a governor-sourced brief should supersede full task replay across multiple attempts.
   - Continue keeping selected `criterionIds`, required context, and verification requirements bounded; keep large artifacts referenced.
4. **Auditor oversight workflow**
   - Initial manual/data-only `stardock_auditor` support exists for ready-to-copy auditor payloads plus compact review records linked to criteria, artifacts, and final reports.
   - Initial read-only `stardock_policy({ action: "auditor" })` trigger support exists for criteria risk, final-report gaps, risky WorkerReports, implementer handoffs, and open breakout packages.
   - Later, add trigger handling for periodic review, pre-completion, scope/criteria changes, automation gates, and drift signals.
   - Later, add policy for blocker findings to constrain, be explicitly rejected by, or escalate the next governor decision.
5. **Worker report / selective review workflow**
   - Initial manual/data-only `WorkerReport` support exists through `stardock_worker_report` for provider-neutral worker results, evaluated criteria, artifact refs, changed files, validation, risks, open questions, suggested next move, and review hints.
   - Worker reports provide request payload guidance telling workers which files/symbols the parent should inspect and why.
   - Worker reports do not execute providers, assume `pi-subagents` output, apply patches, or automate parent review in v1.
   - Later, add a policy that parent/governor reads touched files only for risk, ambiguity, failed validation, public contract changes, or explicit review hints.
6. **Breakout, final verification, and compound learning reports**
   - Initial manual/data-only `BreakoutPackage` support exists through `stardock_breakout` for repeated criterion failures, blocked criteria, unresolved decisions, or no criterion movement.
   - Breakout packages store compact decision/evidence context: linked criteria, attempts, artifacts, final reports, auditor reviews, advisory handoffs, outside requests, last errors, suspected root causes, requested decision, resume criteria, and recommended next actions.
   - Breakout packages do not trigger escalation, call providers, apply edits, or block completion automatically in v1; future policy can recommend or require them at abandonment/escalation gates.
   - Initial read-only `stardock_policy({ action: "breakout" })` trigger support exists for failed/blocked criteria, repeated failed/blocked attempts, no evidence movement, evidence gaps, unresolved outside decisions, blocking auditor follow-ups, and existing open breakout packages.
   - Initial manual `FinalVerificationReport` state and `stardock_final_report` list/record support exists for compact criteria coverage, validation records, artifact refs, unresolved gaps, and compatibility/security/performance notes.
   - Later, add policy for when completion should require or recommend a final report, and how reports interact with auditor review.
   - Add optional compound-learning proposals and cognitive-debt handoff explanations.
7. **Advisory handoff / subagent firewall workflow**
   - Initial provider-neutral `stardock_handoff` support exists for ready-to-copy advisory payloads and compact result records.
   - Parent-owned `stardock_advisory_adapter` payloads now format brief-scoped explorer/test-runner `pi-subagents` invocations while keeping Stardock state provider-neutral and non-executing.
   - Keep Stardock-owned handoff semantics separate from provider execution details; `pi-subagents` is only one possible future execution adapter.
   - Start future direct execution with exploration and test-runner providers only after a safe lifecycle/cancellation/result-capture boundary exists.
   - Do not apply edits automatically.
   - Persist provider-neutral payloads, result summaries, concerns, recommendations, artifact refs, and optional opaque provider metadata.
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
  - builds compact `stardock_auditor` payloads with criteria/artifact/final-report/attempt/governor context
  - records auditor reviews without mutating criteria or implementation state directly
  - keeps v1 manual/data-only with no model calls, subagent execution, or automatic completion blocking
  - later gated versions should include blocker findings in the next governor prompt and require explicit governor response or user escalation before gated moves

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

The initial mode-aware/recursive path and the safe manual/data-only governance/evidence layer are complete. Next execution should not restart earlier implementation tasks. Use this order instead:

1. Dogfood Stardock on real implementation work using criterion distillation, explicit artifacts, final reports, and read-only policy checks.
2. Add first-class baseline validation records and criteria review/update policy only after dogfooding confirms the right granularity and update ownership.
3. Strengthen context packet routing and governor memory only where briefs/outside requests are insufficient.
4. Dogfood workflow transition notifications and prompt gate integration on real checklist runs; tune severity/order before changing loop queueing behavior.
5. Add automatic auditor trigger creation only if read-only gate recommendations prove insufficient.
6. Add exploration/test-runner provider adapters before implementer/editing adapters.
7. Treat editing subagents and `evolve` mode as follow-up projects with separate safety gates and auditor checkpoints.
