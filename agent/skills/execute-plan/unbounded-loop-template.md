# <loop-name>

Continuous unbounded loop (project-owned canonical context file).

## Objective
- Goal: <what improves>
- Primary signal(s): <metrics/checks/review criteria>
- Desired direction or success shape: <increase/decrease/reach threshold/qualitative acceptance>

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

## Rejection / Deferral / Split Rule
- Reject when <condition>.
- Defer when <condition>.
- Split when evidence cannot attribute a mixed attempt.

## Runtime Decision Policy
- Cost/runtime ceiling: <continue/skip/defer/fallback/pause condition>
- Long-running async process: <safe independent work to do while running; wait/pause condition only after useful wait-time work is exhausted>
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

## Runtime
- Runtime loop: `<loop-name>`
- Runner: canonical-file + rolling task/attempt window
- Iteration unit: one complete evaluated attempt
- Optional legacy compatibility: only when resuming an existing planless recursive Stardock loop or when the human explicitly enables `/stardock-legacy on`
- Legacy task role: compact runtime prompt/checkpoint; durable charter remains here
- Legacy evidence: use `stardock_attempt_report` and other legacy evidence tools only on that restored/explicit compatibility surface

## Inner Loop Cadence
- Attempt completion includes measuring, selecting, implementing or explicitly splitting/deferring, post-measuring, deciding, committing accepted kept changes by default when safe, and recording outcome.
- Micro-batch limit: up to 3 independently evaluated/logged micro-attempts only when each reaches a terminal outcome before the iteration advances.
- In a legacy recursive loop, do not call `stardock_done` after partial investigation, async process start, waiting for benchmarks, or unevaluated edits unless a predeclared pause/blocker policy applies.

## Compaction
- Trigger: every <N> attempts or when file exceeds <size target>
- Compaction command/procedure: `<command or manual rule>`
- Keep in this file: current state + 1-3 active hypotheses + last 3-5 attempt summaries
- Last compaction: <timestamp + archive pointer>

## Single Source of Truth
- This project-owned file owns objective/protocol/thresholds/current state/active hypotheses/recent decisions and pointers.
- The canonical loop file owns runtime truth; an active legacy Stardock loop owns only its compatibility runtime/evidence records.
- Do not duplicate these sections in separate plan summaries, optional legacy task files, or plan files; store only pointers elsewhere.
- Bulky notes and verification evidence belong in per-attempt/domain artifacts, not pasted into optional legacy state.

## Current Attempt
- Attempt: <attempt-id>
- Attempt file: `.pi/loops/<loop-name>/attempts/<attempt-id>.md` or pending
- Status: ready / measuring / selecting / implementing / validating / deciding / recording

## Current Attempt Checklist
- [ ] Measure or validate current baseline/state
- [ ] Inspect evidence and select exactly one candidate
- [ ] Implement one coherent candidate, or split/defer/reject before editing
- [ ] Run focused correctness/guardrail checks
- [ ] Run post-change measurement or evaluation
- [ ] Inspect benchmark/log/artifact output against decision rules
- [ ] Decide accepted/rejected/deferred/split/blocked
- [ ] Commit accepted kept change by default when safe, or record why it remains uncommitted; revert/record non-accepted outcome
- [ ] Update Recent Attempts row and current state snapshot when applicable
- [ ] Record the hypothesis, action, validation, result, keep/reset decision, and evidence pointer in canonical state; if running a legacy recursive loop, also record `stardock_attempt_report` before `stardock_done`
