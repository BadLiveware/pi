# Unbounded Work Execution

Use this reference from `execute-plan` when the active plan, charter, or user request implies open-ended work that should continue until the user stops it, not until a finite checklist is exhausted. The user probably will not say "unbounded"; infer it from loop semantics and stop conditions.

## Outcome
- active Ralph loop or equivalent iterative runner for continuous iteration
- each iteration runs: check/measure current state -> candidate change -> evaluate -> accept/reject/defer/split -> durable record
- artifact policy follows the loop charter: durable domain artifacts when they have long-term value, compact anti-repeat notes for lightweight loops
- loop continues through next hypotheses without standalone status pauses

## Prerequisites
- project-owned canonical loop file exists, normally `.pi/loops/<loop-name>/loop.md`
- evaluation protocol and acceptance/guardrail rules are explicit
- current state snapshot is present in that file

Optional:
- compact append-only detail archive such as `.pi/loops/<loop-name>/attempt-archive.ndjson`
- `.ralph/<loop-name>.md` runtime file that points to or mirrors the canonical loop file for the Ralph extension

If prerequisites are missing, return to `planning` and read `../planning/unbounded-work.md`.

## Iteration Contract
For every attempt:
1. **Check or measure current state** using the charter protocol.
2. **Apply one coherent candidate change** small enough to attribute impact.
3. **Evaluate candidate** with the same protocol or declared review criteria.
4. **Decide** using acceptance/guardrail rules: accept, reject, defer, or split.
5. **Record compactly in the canonical loop file**: attempt id, hypothesis, key evidence, decision, and next hypothesis.
6. **Archive detail only if useful**: raw logs/verbose tables go to optional archive/artifact paths, not the active loop context.
7. **Persist outcome according to the loop's artifact policy**:
   - Accept: commit kept state when commit permission is active and commits are the chosen durable artifact; otherwise record the accepted state in the canonical loop file or domain artifact.
   - Reject/defer/split: revert candidate code unless intentionally retained; write a durable negative-result artifact only when the lesson has long-term repo/product value, otherwise keep a compact anti-repeat note with retry conditions in the canonical file.

## Ralph Loop Setup
1. Keep `.pi/loops/<loop-name>/loop.md` as the live project-owned canonical execution file.
2. Treat `.ralph/<loop-name>.md` as runtime state for the Ralph extension; make it a thin pointer or compact mirror of the canonical file, not a separate source of truth.
3. Do not require agents to read multiple long layers to continue work.
4. Keep the canonical file compact: objective, current state snapshot, active hypotheses, last few attempt summaries, and minimal verification pointers.
5. Start with `ralph_start` and keep iterating with `ralph_done` after real progress.
6. Use a high iteration budget or restart seamlessly when max iteration is reached.
7. Recommended defaults: `itemsPerIteration: 1`, `reflectEvery: 5`, `maxIterations: 200`.

## Inner Loop Size
Default each Ralph iteration to one complete evaluated attempt.

An attempt is complete only after:
- current-state measurement/check or trusted baseline reference
- one coherent candidate change
- candidate evaluation using the same protocol or declared criteria
- accept/reject/defer/split decision
- canonical loop update
- checkpoint commit/revert if commit permission is active and appropriate

Batch up to 3 tightly related micro-attempts in one iteration only when each is independently evaluated, logged, and decided. Do not call `ralph_done` after mere investigation, partial edits, TODOs, or unevaluated changes unless blocked by the Stop Policy.

## Single-Source-of-Truth Rule
Do not duplicate the same content across `.pi/loops/<loop-name>/loop.md`, `.ralph/<loop-name>.md`, plan summary files, and plan files.

Execution rule:
- update the project-owned canonical loop file for current truth
- for accepted changes, point to the commit/artifact rather than copying full result prose elsewhere
- for rejected/deferred lessons with durable domain value, write independent negative-result documentation and keep only a short pointer/summary in the canonical file
- for lightweight rejected/deferred lessons, keep only compact anti-repeat notes in the canonical file
- for verbose/raw data, append to optional archive/artifact paths only when useful and store only a pointer in the canonical file
- if another process file must exist, keep it as a thin pointer/index, not duplicated prose/tables

## Stop Policy
Do not stop for routine progress updates, completed single attempts, or temporary local maxima.

Stop only when:
1. user explicitly asks to stop or pause
2. a blocker requires user decision/credentials/approval
3. destructive or external side effect needs approval
4. evaluation harness/process is invalid and cannot be repaired safely in scope
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
