# Ralph Loop Modes Plan

## Purpose

Evolve the local `ralph-loop` extension from a single checklist loop into a mode-aware loop engine. The first new capability should support different goal shapes and setup instructions, while preserving the current simple start-to-finish behavior as the default.

The design should make room for an OpenEvolve-inspired mode, but should not jump directly to full evolutionary search until the engine and recursive attempt logging are stable.

## Desired end state

- Existing callers of `ralph_start` and `ralph_done` continue to work for simple checklist loops.
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
- Do not break existing `.ralph/<name>.state.json` files.
- Do not make outside research automatically spawn subagents until the request/response data model is stable.
- Do not put all subagent orchestration directly inside the extension until Pi exposes a clean, safe extension API for that. The extension should own state and requests first; the parent/orchestrator agent can run subagents through existing tools.

## Current implemented baseline

Last updated: 2026-04-30.

Implemented and committed:

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

Implemented behavior:

- Modes:
  - `checklist`: default, compatibility-preserving loop behavior.
  - `recursive`: bounded attempts with objective/setup state, attempt reports, outside requests, governor decisions, and trigger support.
  - `evolve`: reserved; design-gated in `.pi/plans/ralph-evolve-mode.md`.
- Compatibility:
  - v1 state files without mode metadata migrate to `schemaVersion: 2` checklist state.
  - Top-level compatibility fields remain saved.
- Tools:
  - `ralph_start`
  - `ralph_done`
  - `ralph_attempt_report`
  - `ralph_govern`
  - `ralph_outside_requests`
  - `ralph_outside_payload`
  - `ralph_outside_answer`
- Commands:
  - `/ralph ...`
  - `/ralph govern [loop]`
  - `/ralph outside [loop]`
  - `/ralph outside payload <loop> <request-id>`
  - `/ralph outside answer <loop> <request-id> <answer>`
  - `/ralph-stop`
- Recursive behavior:
  - structured attempt reports carry hypothesis, kind, action summary, validation, result, keep/reset, evidence, and follow-up ideas;
  - `outsideHelpEvery` preserves interval governor reviews;
  - `governEvery` provides independent governor cadence;
  - stagnation creates `failure_analysis` requests;
  - scaffolding drift creates `mutation_suggestions` requests;
  - `ralph_govern` creates a manual governor request and payload without calling a model or spawning subagents;
  - recorded governor decisions appear as constraints in subsequent recursive prompts.

## Updated design direction: context routing, not prompt replay

Dogfooding showed that repeating the canonical task or plan each iteration is often the wrong context shape. The canonical plan can be larger than what the next worker needs and can distract the agent from the specific next move.

Future Ralph work should treat the canonical plan and task file as durable source material, not as the default iteration prompt. Each iteration should receive a **context packet** selected for that attempt:

1. **Specific job** — the one bounded action to perform now.
2. **Acceptance criteria** — what makes this attempt complete.
3. **Required context** — only the relevant plan excerpts, files, decisions, and constraints.
4. **Future-preserving constraints** — invariants, compatibility notes, and what not to overbuild.
5. **Output contract** — attempt report, changed files, validation evidence, risks, and suggested next move.

The governor should own context selection. Instead of `ralph_done` blindly queuing the same task content, the target architecture is:

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
  acceptanceCriteria: string[];
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
  validation: Array<{ command: string; result: "passed" | "failed" | "skipped"; summary: string }>;
  risks: string[];
  openQuestions: string[];
  suggestedNextMove?: string;
  reviewHints: string[];
}
```

Subagents should help the governor avoid “driving down the ditch”: the implementer does one bounded attempt, while the governor owns direction, stop/pivot/continue decisions, and context routing. The parent/governor should not automatically reread every file a worker touched; it should consume structured worker reports and inspect only high-risk, ambiguous, failed, or public-contract-changing areas.

## Remaining future work summary

The practical implementation path is complete through bounded recursive/governor workflow. Remaining work is design-gated and should be driven by dogfood evidence:

1. **Context packet routing**
   - add `GovernorState` and `IterationBrief` only after manual governor/payload workflows show what context is repeatedly needed;
   - make prompts brief-by-default and source the canonical plan selectively;
   - keep large artifacts referenced, not pasted.
2. **Worker/subagent handoff quality**
   - define a durable `WorkerReport` contract;
   - add selective parent review policy so the governor does not duplicate worker work;
   - implement advisory-only subagent flow before any editing flow.
3. **Subagent-driven recursive mode**
   - use `.pi/plans/ralph-subagent-recursive-mode.md` as the design gate;
   - do not spawn subagents directly from the extension until lifecycle, cancellation, result capture, and edit ownership are safe.
4. **Evolve mode**
   - use `.pi/plans/ralph-evolve-mode.md` as the design gate;
   - implement only after evaluator contracts, isolation, archive bounds, prompt bounds, and dogfood evidence are available.

## Architecture decision

### Data/state shape

Keep one top-level loop state with a mode-specific nested payload:

```ts
type LoopMode = "checklist" | "recursive" | "evolve";

type LoopStatus = "active" | "paused" | "completed";

interface LoopState {
  schemaVersion: 2;
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
}
```

Compatibility rule: missing `schemaVersion` or `mode` means `schemaVersion: 1`, `mode: "checklist"`, and `modeState` is synthesized from the existing fields. Missing `outsideRequests` is synthesized as an empty list.

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

There are three distinct outside/worker roles for recursive and evolve loops:

1. **Governor** — owns loop direction. Reviews trajectory and decides whether effort is being spent well, has narrowed too far, is stuck in scaffolding/setup work, or needs a hard steer toward measurement and candidate changes.
2. **Implementer** — owns one bounded attempt. It should not own the overall decision to keep pursuing its current lane.
3. **Researcher** — supplies new ideas, mutations, prior art, examples, benchmarks, or failure explanations when the governor requests more options.

The governor is not just a normal reflection prompt. It should have authority to emit steering decisions that the next iteration must follow unless the main agent records a concrete reason to reject them.

Long-term recursive/evolve loops should be capable of this manager/worker cadence:

```text
Governor chooses next move
→ Implementer performs one bounded attempt
→ validation/evaluation runs
→ Implementer records attempt report
→ Governor reviews evidence and either continues, pivots, requests research, stops, or asks the user
```

For the first implementation passes, keep this as state and prompt structure. Do not require the extension to spawn subagents directly.

```ts
interface OutsideRequest {
  id: string;
  kind: "ideas" | "research" | "mutation_suggestions" | "failure_analysis" | "governor_review";
  status: "requested" | "in_progress" | "answered" | "dismissed";
  requestedAt: string;
  requestedByIteration: number;
  trigger: "every_n_iterations" | "out_of_ideas" | "manual" | "stagnation" | "scaffolding_drift" | "low_value_lane";
  prompt: string;
  answer?: string;
  decision?: GovernorDecision;
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
- number of loops in `.ralph/`
- task file size
- number of attempts/candidates in mode state
- number and size of outside request answers
- evaluator command output size for future recursive/evolve validation

Bounds:
- list/status reads only `.state.json` files in `.ralph/` and `.ralph/archive/`.
- mode summaries cap rendered attempt/candidate/request rows.
- recursive/evolve logs store summaries in state and detailed artifacts in separate files when content grows.
- evaluator outputs in future modes must have timeouts and byte caps before being inserted into prompts.

## Mode semantics

### Orchestration model by mode

- `checklist`: in-session single-agent loop by default. The main agent can keep working through a finite checklist without governor overhead.
- `recursive`: governed loop. Initially the main agent may still perform implementation, but the state model and prompts should treat each iteration as a bounded implementer attempt that is subject to governor review.
- `evolve`: manager/worker loop. Candidate generation, evaluation, archive management, and research injection should eventually be separated, likely with subagents/worktrees, but only after recursive mode has been dogfooded.

### `checklist` mode

Purpose: finite known work.

Behavior:
- Default mode for old and new `ralph_start` calls.
- Current prompt remains materially the same.
- Current task file markdown remains valid.
- `ralph_done` increments iteration and queues the next checklist prompt.
- Completion marker completes the loop.

Acceptance:
- Existing tests still pass.
- Existing `.ralph/*.state.json` files load as checklist loops.

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
- Call `ralph_done` if more plausible ideas remain.
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
| Structured attempt reports | Done | `945b100`; `ralph_attempt_report` records hypothesis/action/validation/result/evidence. |
| Request payloads/templates | Done | `bf22925`; ready-to-copy governor/researcher payloads. |
| Trigger mechanics | Done | `a233c34`; `governEvery`, stagnation, and scaffolding-drift request creation. |
| Manual governor helper | Done | `a66512c`; `ralph_govern` creates/reuses a durable governor request and payload. |
| Future automation design gates | Done | `417f768`; subagent and evolve plans written. |

### Next implementation candidates

Do not restart the completed implementation path. Future implementation should begin with one of these design-gated slices:

1. **Context packet routing**
   - Add `GovernorState` and `IterationBrief` after dogfooding confirms the needed fields.
   - Change recursive prompt generation so a governor-selected brief, not the full canonical plan, becomes the normal worker prompt.
   - Add tests that the prompt includes only selected context and still preserves required constraints.
2. **Worker report / selective review workflow**
   - Define `WorkerReport` state and payload expectations.
   - Add request payload guidance telling workers which files/symbols the parent should inspect and why.
   - Add a policy that parent/governor reads touched files only for risk, ambiguity, failed validation, public contract changes, or explicit review hints.
3. **Advisory subagent workflow**
   - Start with advisory-only worker runs if a safe extension/subagent API exists.
   - Do not apply edits automatically.
   - Persist worker run payload, result, failure, and artifacts.
4. **Evolve mode**
   - Start only after `.pi/plans/ralph-evolve-mode.md` gates are satisfied.
   - Require evaluator timeout/output caps, archive caps, candidate summary bounds, and isolation choice before implementation.

### Completion boundary

The original mode-aware/recursive plan is complete up to the safe boundary. Direct subagent execution and evolve candidate execution are intentionally not implemented because they require design approval and safety proof points.

## Validation strategy

Per commit:
- `npm run typecheck --prefix agent/extensions`
- `npm test --prefix agent/extensions -- public/ralph-loop/index.test.ts`
- `git diff --check -- agent/extensions/public/ralph-loop`

After behavior changes:
- `./link-into-pi-agent.sh`
- reload/restart Pi
- smoke checklist loop:
  - `ralph_start` queues prompt
  - completion marker completes without extension error
- smoke recursive loop after recursive/outside-request changes:
  - starts with mode state
  - queues recursive prompt
  - creates/preserves attempt log
  - creates outside/governor requests when configured
  - records outside answers or governor decisions
  - includes latest steer in the next prompt
  - completion marker completes without extension error

## Risks and mitigations

- Risk: breaking existing `.ralph` state files.
  - Mitigation: migration tests with v1 fixtures and preserving top-level fields.
- Risk: prompt bloat from attempt/candidate logs.
  - Mitigation: cap prompt summaries and move large artifacts to separate files.
- Risk: outside research creates distracting work or loops forever.
  - Mitigation: make outside requests data-only first, with explicit budgets/triggers.
- Risk: evolve mode mutates code unsafely.
  - Mitigation: require evaluator command, timeouts, archive caps, and later worktree/patch isolation before automatic candidate search.
- Risk: mode setup becomes too complex for natural language use.
  - Mitigation: keep `checklist` default simple; add mode-specific setup helpers only after user-facing examples settle.

## Execution recommendation

The initial implementation path is complete through basic recursive outside/governor workflow. Next execution should not restart at task 1. Use this order instead:

1. Dogfood recursive mode on one or two real debugging or optimization tasks.
2. Record where task-file-only attempt reports are insufficient.
3. If needed, add structured attempt reporting and ready-to-copy governor/researcher prompts.
4. Add `governEvery`, stagnation, or scaffolding-drift triggers only after attempt data can support them.
5. Consider semi-automatic governor helpers after the manual workflow is stable.
6. Treat subagent-driven recursive mode and `evolve` mode as follow-up projects with separate plans.
