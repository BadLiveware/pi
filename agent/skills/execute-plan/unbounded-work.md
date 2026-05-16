# Unbounded Work Execution

Use this reference from `execute-plan` when the active plan, charter, or user request implies open-ended work that should continue until the user stops, not until a finite checklist is exhausted. Infer this from loop semantics and stop conditions; the user probably will not say "unbounded".

## Outcome
- active Stardock recursive loop for continuous iteration when Stardock tools are available, unless the user explicitly opts out or chooses another runner
- attempt-driven iterations run one full attempt: measure/check current state -> select one candidate -> implement or split/defer -> evaluate -> decide -> persist outcome -> record evidence -> continue
- artifact policy follows the loop charter: durable domain artifacts when they have long-term value, compact anti-repeat notes for lightweight loops
- loop continues through next hypotheses without standalone status pauses

## Prerequisites
- project-owned canonical loop file exists, normally `.pi/loops/<loop-name>/loop.md`, or the Stardock task content contains the same decision-critical charter
- evaluation protocol and acceptance/guardrail rules are explicit
- current state snapshot or baseline evidence is present
- runtime decision policy covers cost/runtime ceilings, missing credentials/data, destructive/external actions, ambiguous product/architecture choices, invalid evaluation harnesses, and promising out-of-scope ideas

Optional support files:
- per-attempt notes/evidence files such as `.pi/loops/<loop-name>/attempts/<attempt-id>.md`
- compact append-only detail archive such as `.pi/loops/<loop-name>/attempt-archive.ndjson`

If prerequisites are missing, return to `planning` and read `../planning/unbounded-work.md`.

## Iteration Contract
For every attempt:
1. **Check or measure current state** using the charter protocol.
2. **Inspect evidence and select exactly one candidate**, or explicitly split/defer/reject before editing when evidence does not justify a coherent candidate.
3. **Apply one coherent candidate change** small enough to attribute impact.
4. **Evaluate candidate** with the same protocol or declared review criteria.
5. **Decide** using acceptance/guardrail rules: accept, reject, defer, split, or blocked.
6. **Record bulky notes/evidence outside the canonical file and Stardock state** when they would bloat either one, normally in `.pi/loops/<loop-name>/attempts/<attempt-id>.md` or domain artifacts.
7. **Record compactly**: attempt id, hypothesis, key evidence summary, result, keep/reset decision, next hypothesis, and pointer to the attempt/evidence artifact. Use `stardock_attempt_report` when available.
8. **Archive detail only if useful**: raw logs/verbose tables go to optional archive/artifact paths, not the active loop context.
9. **Persist outcome according to the loop's artifact policy**:
   - Accept: commit kept state by default when commits are the chosen durable artifact; otherwise record the accepted state in the canonical loop file or domain artifact.
   - Reject/defer/split: revert candidate code unless intentionally retained; write a durable negative-result artifact only when the lesson has long-term repo/product value, otherwise keep a compact anti-repeat note with retry conditions.
10. **Advance Stardock only after the attempt reaches a terminal outcome**. Do not call `stardock_done` after partial investigation, async process start, waiting for benchmarks, or unevaluated edits unless a predeclared pause/blocker policy applies.

## Stardock Recursive Setup
Use Stardock by default for unbounded execution when the tools are available. Do not begin the first attempt with only `TaskCreate`, background processes, or ad-hoc notes unless the user opts out of Stardock or Stardock is unavailable; if unavailable, record that runner gap in the canonical loop file.

Recommended `stardock_start` shape for attempt-driven optimization/experiment loops:

```js
stardock_start({
  name: "<loop-name>",
  mode: "recursive",
  taskContent: "<compact charter or pointer to .pi/loops/<loop-name>/loop.md>",
  objective: "<objective from charter>",
  baseline: "<current best evidence or state>",
  validationCommand: "<primary check or measurement command>",
  resetPolicy: "manual",
  stopWhen: ["target_reached", "idea_exhaustion", "max_iterations"],
  itemsPerIteration: 0,
  reflectEvery: 5,
  maxIterations: 200,
  outsideHelpOnStagnation: true
})
```

Choose the pacing model before `stardock_start`:

- **Attempt-driven loops** such as optimization, experiment, benchmark, hardening, or research attempts: use `itemsPerIteration: 0`. One Stardock iteration is one complete attempt/cycle, not one checklist item.
- **Item-queue loops** such as migrating files, fixing lint warnings, or processing independent tickets: use `itemsPerIteration: N` only when each checklist item is itself a complete useful work unit.
- If an attempt-driven loop must use `itemsPerIteration > 0`, the top-level checklist must have only attempt-sized items; put internal attempt steps in Notes/plain bullets so they cannot satisfy pacing alone.

Stardock state is runtime state, not a replacement for durable domain artifacts. Keep the task content compact and point to the canonical `.pi/loops/<loop-name>/loop.md` when the charter is too long. Put bulky notes, verification output, and raw evidence in per-attempt/domain artifacts, then point to those artifacts from the canonical file and Stardock artifact/attempt records.

Use these tools when their evidence model fits:
- `stardock_attempt_report` for hypothesis/action/validation/result/keep-reset data.
- `stardock_ledger` for explicit criteria and compact artifact refs.
- `stardock_worker_report` or `stardock_handoff` for delegated work that needs parent/governor review.
- `stardock_policy({ action: "breakout" })` and `stardock_breakout` when repeated attempts are blocked, invalid, worse, or evidence-poor.
- `stardock_policy({ action: "auditor" })` and `stardock_auditor` when high-risk gaps, skipped evidence, or risky worker reports need oversight.
- `stardock_policy({ action: "completion" })` and `stardock_final_report` before substantial completion when criteria/artifacts/final evidence exist or risk is high.

## Inner Loop Size
Default each Stardock iteration in an attempt-driven loop to one complete evaluated attempt. For optimization loops, an attempt includes everything required to take one candidate from evidence-backed selection to terminal outcome and prepare the next attempt.

An optimization/experiment attempt is complete only after:
- current-state measurement/check or trusted baseline reference
- evidence inspection and selection of exactly one candidate, or an explicit split/defer/reject before editing
- one coherent candidate implementation when a candidate is selected
- focused correctness/guardrail checks appropriate to the change
- post-change measurement/evaluation using the charter protocol
- benchmark/log/artifact inspection against acceptance and guardrail rules
- accept/reject/defer/split/blocked decision
- accepted kept changes committed by default when commits are the chosen durable artifact, unless committing is explicitly disabled or unsafe
- rejected/deferred/split code reverted unless intentionally retained under the artifact policy
- attempt artifact/canonical loop file updated with compact evidence pointers
- `stardock_attempt_report` recorded when available

Starting an async process is not an evaluated attempt. Do not call `stardock_done`, mark the iteration complete, or claim meaningful progress merely because a benchmark/test/sweep was launched. Consume the process result, inspect the artifacts/logs, evaluate against the decision rules, and record the outcome first.

If a process is legitimately long-running, follow the charter's predeclared wait policy and exhaust useful wait-time work before yielding: inspect previous artifacts, prepare comparison/rendering commands, review the candidate diff, inspect relevant code or corpus inputs, run safe non-conflicting checks, or refine the next hypothesis. Do not end the turn with a standalone waiting/status response while safe useful work remains. If no safe useful work remains, keep the same Stardock iteration open and rely on process notifications; do not defer evaluation to a future iteration by calling `stardock_done`.

Batch up to 3 tightly related micro-attempts in one iteration only when each is independently evaluated, logged, decided, and represented in the attempt report/canonical state. Do not call `stardock_done` after mere investigation, process start, partial edits, TODOs, or unevaluated changes unless a predeclared pause/blocker policy applies.

## Single-Source-of-Truth Rule
Do not duplicate the same content across `.pi/loops/<loop-name>/loop.md`, `.stardock` task/state, plan summary files, and plan files.

Execution rule:
- update the project-owned canonical loop file for durable current truth when one exists
- update Stardock with compact runtime evidence records, not pasted logs
- for accepted changes, point to the commit/artifact rather than copying full result prose elsewhere
- for rejected/deferred lessons with durable domain value, write independent negative-result documentation and keep only a short pointer/summary in the canonical file
- for lightweight rejected/deferred lessons, keep only compact anti-repeat notes in the canonical file
- for bulky current-attempt notes/verification, write per-attempt/domain artifacts and keep only pointers in both Stardock records and the canonical file
- for verbose/raw data, append to optional archive/artifact paths only when useful and store only a pointer in the canonical file
- if another process file must exist, keep it as a thin pointer/index, not duplicated prose/tables

## Runtime Decision Policy
There is no useful open-ended "what next?" mode inside an autonomous loop. Resolve decision boundaries before starting.

The canonical loop file or Stardock task content must define what to do when an attempt reaches:
- cost or runtime ceilings
- destructive, external, or irreversible actions
- missing credentials/infrastructure/data
- unclear product or architecture tradeoffs
- invalid/noisy evaluation harnesses
- out-of-scope but promising ideas

At runtime, choose the predeclared behavior: continue, skip, defer, use a safe fallback, record a blocker, or pause. Do not emit open-ended recommendations asking what to do next.

## Pause Policy
Do not pause for routine progress updates, completed single attempts, temporary local maxima, or recommendations.

Pause only when:
1. user explicitly stops or pauses the loop
2. the predeclared runtime policy says the condition is unrecoverable without user action
3. unsafe/destructive/external action is needed and no preapproval/fallback exists
4. evaluation harness/process is invalid and cannot be repaired safely under the charter
5. agreed stop criteria are reached

## Compaction
Run compaction periodically so iterative agents avoid reading stale bulk context.

Default behavior:
1. Trigger compaction every N attempts (for example every 5) or when canonical file gets too large.
2. Keep only decision-critical context in `.pi/loops/<loop-name>/loop.md`: objective/protocol/thresholds/current state/1-3 active hypotheses/last 3-5 attempt summaries.
3. Move older verbose details to optional archive and leave one pointer note in canonical file.
4. Never duplicate archived details back into plan summaries or secondary files.

## Completion Marker
Do not emit `<promise>COMPLETE</promise>` for a still-running unbounded loop. Emit it only when the user explicitly ends the loop or agreed stop criteria are reached.
