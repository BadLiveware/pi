# Unbounded Work Execution

Use this reference from `execute-plan` when the active plan, charter, or user request implies open-ended work that should continue until the user stops it, not until a finite checklist is exhausted. The user probably will not say "unbounded"; infer it from loop semantics and stop conditions.

## Outcome
- active Ralph loop for continuous iteration when the Ralph extension/tools are available, unless the user explicitly opts out or chooses another runner
- attempt-driven iterations run one full attempt: measure/check current state -> select one candidate -> implement or split/defer -> evaluate -> decide -> persist outcome -> reset runtime checklist
- artifact policy follows the loop charter: durable domain artifacts when they have long-term value, compact anti-repeat notes for lightweight loops
- loop continues through next hypotheses without standalone status pauses

## Prerequisites
- project-owned canonical loop file exists, normally `.pi/loops/<loop-name>/loop.md`
- evaluation protocol and acceptance/guardrail rules are explicit
- current state snapshot is present in that file

Optional support files:
- per-attempt notes/evidence files such as `.pi/loops/<loop-name>/attempts/<attempt-id>.md`
- compact append-only detail archive such as `.pi/loops/<loop-name>/attempt-archive.ndjson`

Required when Ralph is available and not explicitly opted out:
- `.ralph/<loop-name>.md` runtime file that points to or mirrors the canonical loop file for the Ralph extension

If prerequisites are missing, return to `planning` and read `../planning/unbounded-work.md`.

## Iteration Contract
For every attempt:
1. **Check or measure current state** using the charter protocol.
2. **Inspect evidence and select exactly one candidate**, or explicitly split/defer/reject before editing when evidence does not justify a coherent candidate.
3. **Apply one coherent candidate change** small enough to attribute impact.
4. **Evaluate candidate** with the same protocol or declared review criteria.
5. **Decide** using acceptance/guardrail rules: accept, reject, defer, split, or blocked.
6. **Record bulky notes/evidence outside both runtime and canonical files** when they would bloat either file, normally in `.pi/loops/<loop-name>/attempts/<attempt-id>.md` or domain artifacts.
7. **Record compactly in the canonical loop file**: attempt id, hypothesis, key evidence summary, decision, next hypothesis, and pointer to the attempt/evidence artifact.
8. **Archive detail only if useful**: raw logs/verbose tables go to optional archive/artifact paths, not the active loop context.
9. **Persist outcome according to the loop's artifact policy**:
   - Accept: commit kept state when commit permission is active and commits are the chosen durable artifact; otherwise record the accepted state in the canonical loop file or domain artifact.
   - Reject/defer/split: revert candidate code unless intentionally retained; write a durable negative-result artifact only when the lesson has long-term repo/product value, otherwise keep a compact anti-repeat note with retry conditions in the canonical file.
10. **Reset the runtime checklist for the next attempt before `ralph_done`** in attempt-driven Ralph loops.

## Ralph Loop Setup
Use Ralph by default for unbounded execution when the Ralph extension/tools are available. Do not begin the first attempt with only `TaskCreate`, background processes, or ad-hoc notes unless the user opts out of Ralph or Ralph is unavailable; if unavailable, record that runner gap in the canonical loop file.

First read and follow the `pi-ralph-wiggum` skill. Its runtime mechanics are authoritative: `itemsPerIteration` is a prompt hint, not an enforced counter. Choose the pacing model before `ralph_start`:

- **Attempt-driven loops** such as optimization, experiment, benchmark, hardening, or research attempts: use `itemsPerIteration: 0`. One Ralph iteration is one complete attempt/cycle, not one checklist item.
- **Item-queue loops** such as migrating files, fixing lint warnings, or processing independent tickets: use `itemsPerIteration: N` only when each checklist item is itself a complete useful work unit.
- If an attempt-driven loop must use `itemsPerIteration > 0`, the top-level checklist must have only attempt-sized items; put internal attempt steps in Notes/plain bullets so they cannot satisfy Ralph pacing alone.

1. Keep `.pi/loops/<loop-name>/loop.md` as the live project-owned canonical execution file.
2. Before calling `ralph_start`, write `.ralph/<loop-name>.md`; the Ralph tool does not create this file.
3. Make `.ralph/<loop-name>.md` a thin runtime task file that points to the canonical loop file and contains Ralph-required sections: goals, checklist, verification, and notes.
4. For attempt-driven loops, make `.ralph/<loop-name>.md` contain a reusable **Current Attempt Checklist**. The checklist may have many boxes, but they are attempt-internal; the iteration is not complete until every applicable box for the current attempt is complete and the file has been reset to the next attempt.
5. For item-queue loops, checklist boxes may be independent work items and `itemsPerIteration` may pace them.
6. Pass the same content to `ralph_start({ name, taskContent, itemsPerIteration, reflectEvery, maxIterations })`.
7. Treat `.ralph/<loop-name>.md` as runtime state for the Ralph extension, not a separate source of truth. Update it each iteration with only current progress and short evidence pointers.
8. Keep `.ralph/<loop-name>.md` aggressively compact. Its Notes and Verification sections must not become append-only logs; replace stale entries with the current iteration summary and pointers.
9. Keep `.pi/loops/<loop-name>/loop.md` compact too. Do not move Ralph Notes/Verification bulk into it. Put bulky notes, verification output, and raw evidence in per-attempt/domain artifacts, then point to those artifacts from both `.ralph` and the canonical loop file.
10. Do not require agents to read multiple long layers to continue work.
11. Keep the canonical file limited to objective, current state snapshot, active hypotheses, last few attempt summaries, decisions, and minimal evidence pointers.
12. Before calling `ralph_done` for an attempt-driven loop, rewrite `.ralph/<loop-name>.md` to the next attempt's unchecked checklist and keep only a one-line pointer to the last completed attempt.
13. Call `ralph_done` only after the iteration unit is complete as defined by Inner Loop Size, or after recording a real blocker under the predeclared runtime policy.
14. Use a high iteration budget or restart seamlessly when max iteration is reached.
15. Recommended defaults: attempt-driven optimization/experiment loops use `itemsPerIteration: 0`, `reflectEvery: 5`, `maxIterations: 200`; item-queue loops choose an explicit `itemsPerIteration: N` matched to item size.

Minimal attempt-driven `.ralph/<loop-name>.md` shape:

```markdown
# <loop-name>

Runtime file for Ralph. Durable loop state lives at `.pi/loops/<loop-name>/loop.md`.

## Goals
- Run one full evaluated attempt per Ralph iteration.
- Update the canonical loop file after each decision.
- Continue until user stop, blocker, or agreed stop criteria.

## Current Attempt
- Attempt: <attempt-id>
- Attempt file: `.pi/loops/<loop-name>/attempts/<attempt-id>.md` or pending
- Status: ready / measuring / selecting / implementing / validating / deciding / resetting

## Checklist
Do not call `ralph_done` until every applicable item below is complete, accepted changes are committed when required, durable records are updated, and this runtime checklist has been reset for the next attempt.

- [ ] Measure or validate current baseline/state
- [ ] Inspect evidence and select exactly one candidate
- [ ] Implement one coherent candidate, or split/defer/reject before editing
- [ ] Run focused correctness/guardrail checks
- [ ] Run post-change measurement or evaluation
- [ ] Inspect benchmark/log/artifact output against decision rules
- [ ] Decide accepted/rejected/deferred/split/blocked
- [ ] Commit accepted kept change when commit permission is active, or record accepted state; revert/record non-accepted outcome
- [ ] Update canonical loop file and attempt artifact with compact evidence pointers
- [ ] Reset this runtime checklist for the next attempt

## Verification
- Current evidence pointer: <path or none yet>
- Full evidence belongs in per-attempt/domain artifacts, not here and not pasted into the canonical loop file.

## Notes
- Last completed attempt: <attempt-id + decision + pointer, or none>
- Current wait policy: <safe work while async processes run; no `ralph_done` for waits>
- Replace stale notes/verification entries instead of appending endlessly.
```

## Inner Loop Size
Default each Ralph iteration in an attempt-driven loop to one complete evaluated attempt. For optimization loops, an attempt includes everything required to take one candidate from evidence-backed selection to terminal outcome and prepare the next attempt.

An optimization/experiment attempt is complete only after:
- current-state measurement/check or trusted baseline reference
- evidence inspection and selection of exactly one candidate, or an explicit split/defer/reject before editing
- one coherent candidate implementation when a candidate is selected
- focused correctness/guardrail checks appropriate to the change
- post-change measurement/evaluation using the charter protocol
- benchmark/log/artifact inspection against acceptance and guardrail rules
- accept/reject/defer/split/blocked decision
- accepted kept changes committed when commit permission is active and commits are the chosen durable artifact
- rejected/deferred/split code reverted unless intentionally retained under the artifact policy
- attempt artifact and canonical loop file updated with compact evidence pointers
- `.ralph/<loop-name>.md` reset to the next attempt's unchecked checklist, with only a short pointer to the completed attempt

Starting an async process is not an evaluated attempt. Do not call `ralph_done`, mark the iteration complete, reset the checklist, or claim meaningful progress merely because a benchmark/test/sweep was launched. Consume the process result, inspect the artifacts/logs, evaluate against the decision rules, and record the outcome first.

If a process is legitimately long-running, follow the charter's predeclared wait policy and exhaust useful wait-time work before yielding: inspect previous artifacts, prepare comparison/rendering commands, review the candidate diff, inspect relevant code or corpus inputs, run safe non-conflicting checks, or refine the next hypothesis. Do not end the turn with a standalone waiting/status response while safe useful work remains. If no safe useful work remains, keep the same Ralph iteration open and rely on process notifications; do not defer evaluation to a future iteration by calling `ralph_done`.

Batch up to 3 tightly related micro-attempts in one iteration only when each is independently evaluated, logged, decided, and represented in the reset state. Do not call `ralph_done` after mere investigation, process start, partial edits, TODOs, or unevaluated changes unless a predeclared pause/blocker policy applies.

## Single-Source-of-Truth Rule
Do not duplicate the same content across `.pi/loops/<loop-name>/loop.md`, `.ralph/<loop-name>.md`, plan summary files, and plan files.

Execution rule:
- update the project-owned canonical loop file for current truth
- for accepted changes, point to the commit/artifact rather than copying full result prose elsewhere
- for rejected/deferred lessons with durable domain value, write independent negative-result documentation and keep only a short pointer/summary in the canonical file
- for lightweight rejected/deferred lessons, keep only compact anti-repeat notes in the canonical file
- for bulky current-attempt notes/verification, write per-attempt/domain artifacts and keep only pointers in both `.ralph` and the canonical loop file
- for verbose/raw data, append to optional archive/artifact paths only when useful and store only a pointer in the canonical file
- if another process file must exist, keep it as a thin pointer/index, not duplicated prose/tables

## Runtime Decision Policy
There is no useful "stop and ask the user" mode inside a Ralph loop. Resolve decision boundaries before starting the loop.

The canonical loop file must define what to do when an attempt reaches:
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
