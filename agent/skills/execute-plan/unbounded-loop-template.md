# <loop-name>

Continuous unbounded loop (project-owned canonical context file).

## Objective
- Goal:
- Primary signal(s): <metrics/checks/review criteria>
- Desired direction or success shape:

## Guardrails
- <correctness/safety/compatibility/cost/quality constraint>
- <allowed regression or non-negotiable invariant>

## Evaluation Protocol
- Setup: <environment controls>
- Command(s) / check(s):
  - `<command 1>`
- Runs or review standard: <N / checklist / criteria>
- Comparison rule: <median/p95/diff/reviewer acceptance/etc>

## Acceptance Rule
- Accept when <evidence> passes and all guardrails hold.

## Rejection / Deferral Rule
- Reject when <condition>.
- Defer when <condition>.
- Split when evidence cannot attribute a mixed attempt.

## Runtime Decision Policy
- Cost/runtime ceiling: <continue/skip/defer/fallback/pause condition>
- Long-running async process: <safe independent work to do while running; wait/poll/pause condition only after useful wait-time work is exhausted>
- Missing data/credentials/infrastructure: <fallback or pause condition>
- Destructive/external actions: <preapproved actions or pause condition>
- Product/architecture ambiguity: <predeclared safe choice or pause condition>
- Out-of-scope promising idea: <record/defer rule>

## Current State
- Commit/config/state: <sha or state id>
- Latest trusted evidence: <value/path/timestamp>

## Active Hypotheses (keep 1-3)
- [ ] <hypothesis 1>
- [ ] <hypothesis 2>

## Recent Attempts (keep last 3-5 summaries)
| Attempt | Hypothesis | Evidence | Decision | Pointer |
|---|---|---|---|---|
| A-012 | <short> | <short> | accept/reject/defer/split | <commit or doc path> |

## Evidence Pointers
- Current attempt note: `.pi/loops/<loop-name>/attempts/<attempt-id>.md` or <none yet>
- Latest artifact: <path>
- Optional raw log archive: <path or none>
- Negative-result docs: <path or none>

## Ralph Runtime
- Runtime file: `.ralph/<loop-name>.md`
- Ralph file role: thin runtime pointer only; durable state lives here
- Before `ralph_start`: write `.ralph/<loop-name>.md` with goals/current-attempt/checklist/verification/notes and pass the same content as `taskContent`
- Ralph pacing: optimization/experiment loops are attempt-driven; use `itemsPerIteration: 0` so Ralph does not pace by individual checklist boxes
- Ralph checklist rule: checklist boxes are internal to the current attempt; the iteration ends only after the attempt has a terminal outcome and the runtime checklist is reset for the next attempt
- Keep Ralph Notes/Verification short: current iteration status plus pointers only; replace stale entries instead of appending a growing log
- Do not move bulky Ralph notes/verification into this canonical file; put them in per-attempt/domain artifacts and keep pointers here

## Inner Loop Cadence
- Ralph defaults for attempt-driven loops: `itemsPerIteration: 0`, `reflectEvery: 5`, `maxIterations: 200`
- Iteration unit: one complete optimization/experiment attempt
- Attempt completion includes measuring, selecting, implementing or explicitly splitting/deferring, post-measuring, deciding, committing accepted kept changes when commit permission is active, recording outcome, and resetting the Ralph checklist for the next attempt
- Micro-batch limit: up to 3 independently evaluated/logged micro-attempts only when each still reaches a terminal outcome before reset
- Do not call `ralph_done` after partial investigation, async process start, waiting for benchmarks, or unevaluated edits unless a predeclared pause/blocker policy applies

## Compaction
- Trigger: every <N> attempts or when file exceeds <size target>
- Compaction command/procedure: `<command or manual rule>`
- Keep in this file: current state + 1-3 active hypotheses + last 3-5 attempt summaries
- Last compaction: <timestamp + archive pointer>

## Single Source of Truth
- This project-owned file owns objective/protocol/thresholds/current state/active hypotheses/recent decisions and pointers.
- `.ralph/` files are runtime extension artifacts and should only point here or mirror this compactly.
- Do not duplicate these sections in separate plan summaries, Ralph files, or plan files; store only pointers elsewhere.
- Bulky notes and verification evidence belong in per-attempt/domain artifacts, not here.

## Current Attempt
- Attempt: <attempt-id>
- Attempt file: `.pi/loops/<loop-name>/attempts/<attempt-id>.md` or pending
- Status: ready / measuring / selecting / implementing / validating / deciding / resetting

## Current Attempt Checklist
- [ ] Measure or validate current baseline/state
- [ ] Inspect evidence and select exactly one candidate
- [ ] Implement one coherent candidate, or split/defer/reject before editing
- [ ] Run focused correctness/guardrail checks
- [ ] Run post-change measurement or evaluation
- [ ] Inspect benchmark/log/artifact output against decision rules
- [ ] Decide accepted/rejected/deferred/split/blocked
- [ ] Commit accepted kept change when commit permission is active, or record accepted state; revert/record non-accepted outcome
- [ ] Update Recent Attempts row and current state snapshot when applicable
- [ ] Reset `.ralph/<loop-name>.md` to the next attempt's unchecked checklist before `ralph_done`
