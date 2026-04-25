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
- Latest artifact: <path>
- Optional raw log archive: <path or none>
- Negative-result docs: <path or none>

## Inner Loop Cadence
- Ralph defaults: `itemsPerIteration: 1`, `reflectEvery: 5`, `maxIterations: 200`
- Iteration unit: one complete evaluated attempt
- Micro-batch limit: up to 3 independently evaluated/logged micro-attempts
- Do not call `ralph_done` after partial investigation or unevaluated edits unless blocked

## Compaction
- Trigger: every <N> attempts or when file exceeds <size target>
- Compaction command/procedure: `<command or manual rule>`
- Keep in this file: current state + 1-3 active hypotheses + last 3-5 attempt summaries
- Last compaction: <timestamp + archive pointer>

## Single Source of Truth
- This project-owned file owns objective/protocol/thresholds/current state/active hypotheses/recent decisions.
- `.ralph/` files are runtime extension artifacts and should only point here or mirror this compactly.
- Do not duplicate these sections in separate plan summaries, Ralph files, or plan files; store only pointers elsewhere.

## Current Attempt Checklist
- [ ] Check/measure current state
- [ ] Implement candidate
- [ ] Evaluate candidate
- [ ] Decide accept/reject/defer/split
- [ ] Update Recent Attempts row
- [ ] Update current state snapshot if accepted
- [ ] Commit/revert/document checkpoint if permission active
