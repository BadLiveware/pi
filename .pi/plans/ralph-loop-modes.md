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

Current implementation:

- Local extension path: `agent/extensions/public/ralph-loop/index.ts`.
- Current storage:
  - `.ralph/<name>.md`
  - `.ralph/<name>.state.json`
  - `.ralph/archive/`
- Current tools:
  - `ralph_start`
  - `ralph_done`
  - `ralph_outside_requests`
  - `ralph_outside_answer`
- Current commands:
  - `/ralph ...`
  - `/ralph outside [loop]`
  - `/ralph outside answer <loop> <request-id> <answer>`
  - `/ralph-stop`
- Current modes:
  - `checklist`: default and compatibility-preserving.
  - `recursive`: objective-driven bounded attempts with prompt-visible setup state, attempt placeholders, and data-only outside/governor requests.
  - `evolve`: reserved; not implemented.
- Current recursive outside-help behavior:
  - `outsideHelpEvery` creates interval-triggered `governor_review` requests.
  - Pending requests and the latest governor steer are included in recursive prompts.
  - Widget summaries show pending request count and governor steer.
  - Answers and structured governor decisions can be recorded without editing state files manually.
- Current loop prompts ask the agent to update the task file, output `<promise>COMPLETE</promise>` when done, otherwise call `ralph_done`.
- Completion no longer sends a synthetic user message; it persists a `ralph-loop` session entry and uses UI notification.

## Remaining future work summary

The practical first pass is complete through basic data-only outside request/governor support. Future work should focus on dogfooding and targeted increments:

1. Tighten recursive mode data quality:
   - add richer attempt reports or an explicit attempt-reporting tool only if task-file-only reporting proves too weak;
   - add `governEvery` separately from `outsideHelpEvery` if interval governor reviews need independent cadence;
   - add lightweight stagnation/scaffolding-drift detection using attempt classifications once attempts carry enough structured signal.
2. Polish manual outside-agent workflow:
   - return ready-to-copy governor/researcher prompts;
   - add researcher request templates for ideas, failure analysis, and mutation suggestions;
   - make request listing easier to consume from parent/orchestrator agents.
3. Add semi-automatic governed recursive workflow after manual workflow dogfooding.
4. For subagent-driven recursive mode, use `.pi/plans/ralph-subagent-recursive-mode.md` as the design gate.
5. For `evolve` mode, use `.pi/plans/ralph-evolve-mode.md` as the design gate after recursive mode has real dogfood evidence.

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

## Implementation plan

### 1. Refactor loop state and migration without behavior change — implemented

Files:
- `agent/extensions/public/ralph-loop/index.ts`
- `agent/extensions/public/ralph-loop/index.test.ts`

Tasks:
- Add `schemaVersion?: number`, `mode?: LoopMode`, and optional `modeState` fields to `LoopState`.
- Update `migrateState` to synthesize checklist mode for old state files.
- Keep saved top-level fields compatible with the current watchdog and existing state readers.
- Add tests for loading old state shape as checklist mode.

Acceptance:
- Existing start/done/completion tests pass.
- A v1 state fixture without `mode` loads and saves as an active checklist loop.

Validation:
- `npm run typecheck --prefix agent/extensions`
- `npm test --prefix agent/extensions -- public/ralph-loop/index.test.ts`

### 2. Extract checklist mode behind internal mode handler — implemented

Files:
- `agent/extensions/public/ralph-loop/index.ts`
- optionally `agent/extensions/public/ralph-loop/src/modes.ts` if `index.ts` becomes hard to review

Tasks:
- Extract current prompt building into a checklist handler.
- Route `ralph_start`, `/ralph start`, `/ralph resume`, `ralph_done`, and `before_agent_start` through the handler.
- Keep current prompt text stable except for mode labels if necessary.
- Keep completion marker behavior unchanged.

Acceptance:
- Golden-ish tests confirm first prompt still contains `RALPH LOOP`, current task content, item pacing, completion marker, and `ralph_done` instruction.
- No user-visible behavior change for default start.

Validation:
- Same as task 1.
- Manual smoke: start disposable checklist loop and complete it.

### 3. Add mode parameter and setup validation — implemented

Files:
- `index.ts`, tests, README, skill.

Tasks:
- Add optional `mode` to `ralph_start` schema with default `checklist`.
- Add `/ralph start --mode checklist|recursive` parsing, initially allowing only checklist to run fully if recursive is not implemented in the same commit.
- Add clear error messages for unsupported mode/setup combinations.
- Update README and skill to describe mode selection.

Acceptance:
- `ralph_start` without mode behaves exactly as before.
- `ralph_start` with `mode: "checklist"` behaves exactly as before.
- Unsupported mode produces a concise tool result or UI warning, not a partial loop.

Validation:
- Typecheck/tests.
- Manual `/ralph status` after failed unsupported mode shows no stray active loop.

### 4. Implement recursive mode state and prompt — implemented

Files:
- `index.ts` or mode module, tests, README, skill.

Tasks:
- Add recursive setup fields to `ralph_start` schema:
  - `objective`
  - `baseline`
  - `validationCommand`
  - `resetPolicy`
  - `maxFailedAttempts`
  - `outsideHelpEvery`
  - `outsideHelpOnStagnation`
- Add recursive `modeState` with attempt log and idea status.
- Build recursive prompt that asks for one bounded hypothesis/attempt and evidence recording.
- On `ralph_done`, append an attempt placeholder if the agent did not update state explicitly; keep first pass prompt-driven rather than adding a complex attempt tool.
- Render status/widget summary with latest attempt count and objective.

Acceptance:
- Recursive start creates state with `mode: "recursive"` and setup fields.
- Prompt includes objective, validation command if supplied, reset policy, stop conditions, and outside-help policy.
- `ralph_done` advances recursive iteration and preserves attempt log.

Validation:
- Unit tests for recursive start and next prompt.
- Manual smoke with a disposable recursive loop that completes immediately.

### 5. Add outside request queue and governor checkpoint as data-only features — partially implemented

Implemented in `3088421`:
- `outsideRequests` list in loop state with migration default.
- `GovernorDecision` data shape.
- `outsideHelpEvery` creates interval-triggered `governor_review` requests.
- Pending requests and latest governor decisions render in recursive prompts.
- Recursive widget summary includes pending request count and latest required next move.
- `ralph_outside_answer` stores answers and optional structured governor decisions.

Remaining:
- researcher request generation from stagnation/out-of-ideas signals;
- independent `governEvery` cadence if needed;
- failed/neutral attempt accumulation triggers;
- scaffolding-drift detection based on structured attempt classifications.

Files:
- mode state code, README, tests.

Tasks:
- Add `outsideRequests` list to state.
- Add helper to create researcher requests from recursive mode when iteration count hits `outsideHelpEvery` or stagnation threshold.
- Add helper to create governor reviews when iteration count hits `governEvery`, when failed/neutral attempts accumulate, or when scaffolding drift is detected.
- Add a lightweight scaffolding-drift detector based on attempt classifications: repeated `setup`, `refactor`, `instrumentation`, or `benchmark_scaffold` attempts with no subsequent `candidate_change` or `measured_improvement`.
- Render pending outside requests and latest governor decision in the Ralph widget/status summary.
- Add `/ralph outside answer <id>` or a small tool only if needed to inject answers/decisions; otherwise keep answers manual in the task file for the first pass.

Acceptance:
- A recursive loop can record a pending researcher request without launching a subagent.
- A recursive loop can record a pending governor review or latest governor decision.
- Pending requests are visible in `/ralph status` or widget summary.
- The next prompt includes unanswered outside requests and any latest governor steer without blocking normal work.
- A governor `requiredNextMove` is treated as a hard prompt constraint for the next iteration unless the main loop records a concrete rejection reason.

Validation:
- Tests for request creation, governor decision rendering, and scaffolding-drift trigger.
- Manual smoke with `outsideHelpEvery: 1` and `governEvery: 1`.

### 6. Add manual outside-agent workflow — partially implemented

Implemented in `3088421`:
- `ralph_outside_requests` lists requests with state details.
- `ralph_outside_answer` records answers and structured governor decisions.
- `/ralph outside [loop]` lists outside requests.
- `/ralph outside answer <loop> <request-id> <answer>` records a plain-text answer.
- README and skill docs describe the data-only/manual workflow.

Remaining:
- ready-to-copy prompt payloads for governor/researcher execution;
- explicit governor and researcher prompt templates;
- better parent/orchestrator workflow docs once the manual workflow is dogfooded.

Do not automate subagent execution yet. First make pending outside requests easy for the parent/orchestrator agent to execute through existing tools.

Tasks:
- Add command/tool output that lists pending outside requests with ready-to-copy prompts.
- Add `ralph_outside_answer` or equivalent to record governor/researcher answers into loop state.
- Define two prompt templates:
  - Governor prompt: trajectory review, drift detection, next-move decision.
  - Researcher prompt: new mutation/idea/failure-analysis generation for a targeted problem.
- Document parent-agent workflow: inspect request, run `subagent`/`web_search`/research tool, record answer, continue loop.

Acceptance:
- A parent agent can satisfy a pending governor/researcher request without editing state files manually.
- The main loop consumes recorded answers in the next prompt.
- No automatic unbounded research fanout.

Validation:
- Test answer recording and prompt inclusion.
- Manual smoke with a synthetic governor decision that forces a next move.

### 7. Add semi-automatic governed recursive workflow — future

Only after manual outside-agent workflow is dogfooded.

Tasks:
- Add a helper command/tool that returns the exact subagent task payload for pending governor/research requests.
- Optionally add a `ralph_govern` tool that the main agent can call at checkpoints to produce/record a governor decision using the current model, without a separate subagent.
- Keep implementation attempts bounded: one decision, one attempt, one report.

Acceptance:
- Main agent can run a governor checkpoint without prompt engineering from scratch.
- Governor output is structured and recorded durably.
- The next implementer prompt includes the governor decision as a constraint.

Validation:
- Manual dogfood on an optimization task where the governor prevents additional scaffolding.

### 8. Add subagent-driven recursive mode later — design gate written

Detailed design gate: `.pi/plans/ralph-subagent-recursive-mode.md`.

Only after the governor/researcher prompts and answer recording are stable.

Target cadence:

```text
governor -> implementer subagent -> evaluator/validation -> governor
```

Constraints:
- Implementer owns exactly one bounded attempt.
- Governor owns direction and stop/pivot/research decisions.
- Researcher only runs when requested by governor or explicit policy.
- Edits by implementer subagents require a safe ownership model: parent-applied patches, worktrees, or advisory-only first.

Acceptance:
- The loop can run an attempt via subagent and record a structured attempt report.
- Governor can reject scaffolding drift and require measured candidate changes.
- User can inspect and interrupt the loop between attempts.

### 9. Design evolve mode after recursive dogfooding — design gate written

Detailed design gate: `.pi/plans/ralph-evolve-mode.md`.

Create or revise the detailed plan once recursive mode has been used on at least one real debugging or optimization task.

Minimum evidence needed before evolve implementation:
- What recursive logs lacked for candidate selection.
- Whether validation command output needs structured parsing.
- Whether worktree isolation is required.
- How to bound candidate archive and prompt size.

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
