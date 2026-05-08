# Stardock Dogfood Improvements

## Purpose

Use the successful ClickHouse PromQL upstreaming dogfood session to make Stardock easier to drive through real long-running implementation work without weakening evidence discipline.

Primary evidence source:

- Session: `/home/fl/.pi/agent/sessions/--home-fl-code-personal-promshim-ch--/2026-05-05T18-19-48-795Z_019df95e-20ba-7258-b2fe-f7523abd671a.jsonl`
- Loop: `clickhouse-native-promql-upstreaming`
- Outcome: 16 checklist iterations, completion marker emitted, 17 criteria, 16 passed, 1 intentionally blocked/deferred, 89 artifacts, 17 briefs, 7 final reports, 1 breakout package, and 1 auditor review.

The session is a positive corpus: Stardock carried a large plan from planning through multiple fork-local PR slices and final self-assurance. The improvements below target the friction that appeared during that otherwise successful run.

## Desired end state

- Common evidence and status words that agents naturally use are accepted or normalized before they cause noisy schema failures.
- Completion policy distinguishes unsafe unresolved work from explicitly accepted/deferred blockers that have final-report, breakout, and auditor evidence.
- Policy output gives a satisfiable finalization path; once the requested evidence exists, it can report ready with accepted gaps instead of repeating the same recommendations.
- Iteration completion encourages the one-call brief lifecycle path and reduces unnecessary brief/state/status tool chatter.
- Task-file checklist status and Stardock ledger status are easier to reconcile without making the task file a second detailed source of truth.
- The dogfood session yields compact regression fixtures so future changes protect the behaviors that made the run succeed.

## Non-goals

- Do not add automatic subagent/model/provider execution to Stardock.
- Do not make policy a hard gate; it remains advisory.
- Do not import the full 27 MB transcript into the repository as a committed test fixture.
- Do not auto-edit arbitrary task files as the first reconciliation step; start with explicit, inspectable drift reporting.
- Do not change the requirement that substantial completion needs fresh evidence or a clearly packaged accepted gap.

## Observed dogfood signals

### Worked well

- Active briefs made each large PR slice bounded enough for a single iteration.
- The criterion ledger and artifact records provided a durable evidence trail across compactions and long runtime.
- Final reports, breakout packages, and auditor records were expressive enough to explain the intentionally deferred PR15 native-histogram prototype.
- The completion marker and Stardock completion event cleanly closed the loop.

### Friction to fix

- Eight Stardock tool calls failed schema validation before the agent found canonical enum values.
  - `stardock_ledger` rejected artifact kinds naturally used in evidence records: `url`, `manual`, `diff`, `pr`, and `doc`.
  - `stardock_final_report` rejected statuses naturally used for scoped non-work: `blocked` and `skipped`.
  - `stardock_breakout` rejected status `blocked`, even though the package represented a blocked decision gate.
- Completion policy still returned `Ready: no` after PR15 was intentionally blocked, the blocker had a final report, a resolved breakout package, and a passed auditor review.
- The policy continued recommending auditor review for final reports with acknowledged gaps even after a final auditor record accepted the end state.
- The agent manually completed briefs separately from `stardock_done` instead of using the existing `briefLifecycle: "complete"` path.
- The task checklist and ledger were manually synchronized by editing `task.md`, which is error-prone in long plans.

## Affected areas

- Runtime types and migrations:
  - `agent/extensions/private/stardock/src/state/core.ts`
  - `agent/extensions/private/stardock/src/state/migration.ts`
- Tool schemas and normalization:
  - `agent/extensions/private/stardock/src/ledger.ts`
  - `agent/extensions/private/stardock/src/final-reports.ts`
  - `agent/extensions/private/stardock/src/breakout-packages.ts`
  - `agent/extensions/private/stardock/src/app/*-tool.ts`
- Policy and views:
  - `agent/extensions/private/stardock/src/policy.ts`
  - `agent/extensions/private/stardock/src/views.ts`
  - `agent/extensions/private/stardock/src/runtime/prompts.ts`
- Tests and docs:
  - `agent/extensions/private/stardock/test/*.test.ts`
  - `agent/extensions/private/stardock/README.md`
  - `agent/extensions/private/stardock/skills/stardock/SKILL.md`

## Performance shape

The session transcript has 4,676 JSONL entries and is 27 MB. Regression tests should not parse it on every normal test run. Store a compact fixture with only the observed enum-friction examples, final-state shape, and policy-relevant records. Keep policy evaluation linear in counts already present in Stardock state: criteria, artifacts, final reports, auditor reviews, breakout packages, handoffs, worker reports, and attempts. The dogfood final state scale target is at least 20 criteria, 100 artifacts, 20 briefs, 10 final reports, and multiple accepted blockers without noticeable test slowdown.

## Implementation order

### 1. Add compact dogfood regression evidence

Goal: preserve the session lessons in tests without committing the full transcript.

Tasks:

- Add a compact fixture under `agent/extensions/private/stardock/test/fixtures/` containing:
  - session path and summary counts;
  - the eight rejected Stardock tool-call shapes from the transcript;
  - a minimal final state with one passed criterion, one blocked/deferred criterion, a passed final report, a resolved breakout package, and a passed auditor review;
  - expected policy classification for the accepted blocker.
- Add tests that make the fixture executable against the current harness:
  - enum-friction cases exercise the relevant tool schemas and record paths;
  - accepted-blocker state exercises `evaluateCompletionPolicy`.
- Keep the fixture small enough to review in a normal diff.

Acceptance criteria:

- The fixture names the source session but does not embed the full transcript.
- Tests fail against the current behavior for at least the enum-friction and accepted-blocker policy cases before the implementation slices land.
- The fixture can be extended by future dogfood sessions without changing production code.

Validation:

```bash
npm test --prefix agent/extensions -- private/stardock/index.test.ts
```

### 2. Make evidence/status schemas accept common dogfood language

Goal: remove avoidable schema-failure loops while preserving canonical state and policy meaning.

Tasks:

- Extend verification artifact input handling so these dogfood values are accepted:
  - `url` for external links;
  - `pr` for pull-request evidence;
  - `diff` for source diffs or changed-file evidence;
  - `command` for command-output evidence;
  - `doc` and `document` for documentation/progress-log evidence;
  - `manual` as an alias for `other` when no narrower kind applies.
- Use these canonical stored values:
  - add durable artifact kinds for `url`, `pr`, `diff`, `command`, and `document` because they are review-useful categories;
  - normalize `doc` to `document` and `manual` to `other`.
- Add canonical final-report statuses `blocked` and `skipped` alongside `draft`, `passed`, `failed`, and `partial`:
  - `blocked` means the scoped verification item could not proceed until an external decision or prerequisite exists;
  - `skipped` means the scoped verification item was intentionally not run and must be justified by an unresolved gap or accepted-deferral record before completion can be ready.
- Accept breakout input status `blocked` as an alias for `open`, because the package is the object representing an unresolved blocked decision; record `normalizedStatus: { from: "blocked", to: "open" }` in details and keep `resolved` as the canonical accepted decision state.
- Update Typebox schemas, runtime type guards, migration helpers, formatters, and skill/README enum text together.

Acceptance criteria:

- The eight dogfood enum-friction calls no longer produce generic Typebox constant-spam errors.
- Details for normalized breakout inputs report both the provided value and the canonical stored value.
- Existing runs with old artifact kinds and statuses still load.
- Unknown values outside the accepted aliases still fail clearly.

Validation:

```bash
npm run typecheck --prefix agent/extensions
npm test --prefix agent/extensions -- private/stardock/index.test.ts
```

### 3. Teach completion policy about accepted deferred blockers

Goal: make policy recommendations satisfiable when a blocker is intentionally accepted as out of scope.

Tasks:

- Define an accepted blocker predicate for completion policy. A blocked or skipped criterion is accepted when all of these are true:
  - the criterion is referenced by a resolved or dismissed breakout package;
  - the breakout package has a requested decision or recommended next action that explains the deferral;
  - the criterion is covered by a passed final report, or by a passed auditor review that references the criterion or a final report covering it;
  - there is no failed final-report validation record for the accepted blocker.
- Add a completion-policy finding `accepted-deferred-criteria` with severity `info` and recommendation `ready` for accepted blockers.
- Add completion status `ready_with_accepted_gaps`; it has `ready: true`, keeps accepted blocker ids in details, and uses a summary that explicitly names the accepted gaps.
- Exclude accepted blockers from the existing `unresolved-criteria` recommendation.
- Suppress repeated `needs-auditor-review` recommendations for final-report gaps already covered by a passed auditor review, while still warning on failed validation or blocked auditor reviews.
- Keep unsafe cases strict:
  - blocked criteria without resolved breakout packages still produce `needs_decision`;
  - final-report gaps without auditor coverage still produce `needs_review`;
  - open or draft breakout packages still prevent ready status.

Acceptance criteria:

- The dogfood final-state fixture evaluates with `ready: true` and status `ready_with_accepted_gaps`.
- A blocked criterion with no breakout still returns `needs_decision`.
- A resolved breakout with no final report or auditor coverage does not silently make completion ready.
- A passed auditor review only suppresses review recommendations for the criteria/final reports it actually references.

Validation:

```bash
npm test --prefix agent/extensions -- private/stardock/index.test.ts
```

### 4. Improve finalization and iteration lifecycle ergonomics

Goal: reduce extra tool chatter while keeping lifecycle actions explicit.

Tasks:

- Update iteration prompts to recommend the one-call path when an active brief is satisfied:

```js
stardock_done({ briefLifecycle: "complete", includeState: true })
```

- Where policy output recommends follow-up tools, include a compact checklist of already-satisfied evidence and the smallest remaining action.
- Add a finalization-oriented policy summary that differentiates:
  - missing evidence;
  - missing final report;
  - unresolved decision;
  - accepted deferred work;
  - ready.
- Ensure `stardock_done` with `briefLifecycle: "complete"` records the same brief lifecycle state as separate `stardock_brief complete` plus `stardock_done`.
- Update Stardock skill guidance to prefer `followupTool` or one useful include flag instead of repeated state/list calls.

Acceptance criteria:

- Tests cover the one-call brief completion path.
- The next-prompt text shows the lifecycle hint only when an active brief exists.
- The policy summary for the dogfood fixture points to no redundant auditor/breakout action after acceptance evidence exists.

Validation:

```bash
npm test --prefix agent/extensions -- private/stardock/index.test.ts
```

### 5. Add task-checklist and ledger drift reporting

Goal: make manual checklist synchronization safer without auto-editing task files.

Tasks:

- Add a read-only checklist extraction helper for the active task file that identifies top-level Markdown checklist items and checked/unchecked state.
- Add a `stardock_state` or `stardock_ledger list` detail field that reports likely drift between task checklist items and criteria when IDs or requirement text make a confident match.
- Surface drift as advisory text, not as an automatic edit.
- Include common dogfood drift cases:
  - criterion passed while matching task item remains unchecked;
  - criterion blocked while task item remains unchecked and no accepted blocker package exists;
  - task item checked while criterion remains pending.

Acceptance criteria:

- The helper handles the Stardock checklist file shape used in the dogfood session.
- Low-confidence matches are omitted rather than guessed.
- Agents get a concise drift summary that helps them decide whether to edit `task.md` or leave the ledger as the source of evidence.

Validation:

```bash
npm test --prefix agent/extensions -- private/stardock/index.test.ts
```

### 6. Update docs, skill guidance, and dogfood notes

Goal: make future Stardock-driving agents follow the smoother path by default.

Tasks:

- Update `README.md` and `skills/stardock/SKILL.md` with:
  - accepted artifact kinds and status aliases;
  - accepted deferred blocker policy semantics;
  - recommended finalization order for loops with intentionally deferred work;
  - one-call brief lifecycle usage;
  - drift-reporting guidance once implemented.
- Add a dogfood note to the Stardock implementation framework plan or a dedicated dogfood notes section pointing to this session and summarizing the improvements landed from it.
- Keep docs concise enough that they guide behavior rather than replaying the whole session.

Acceptance criteria:

- Docs and skill text match the implemented enum/status behavior.
- The dogfood session is cited as evidence without depending on the full transcript path for normal use.
- Future agents can infer the correct PR15-style accepted-deferral pattern from the docs.

Validation:

```bash
npm run typecheck --prefix agent/extensions
npm test --prefix agent/extensions -- private/stardock/index.test.ts
./link-into-pi-agent.sh
```

## Final acceptance criteria

- All dogfood enum-friction examples either succeed with canonical state or fail with a concise, actionable message.
- Completion policy reports `ready: true` with status `ready_with_accepted_gaps` for the packaged PR15-style blocker and still reports not-ready for unsafe unresolved blockers.
- Stardock prompt/docs steer agents toward `briefLifecycle: "complete"` and away from redundant status calls.
- Checklist/ledger drift is visible before finalization without automatic task-file mutation.
- Typecheck and focused Stardock tests pass.
- Live `~/.pi/agent` symlinks are refreshed with `./link-into-pi-agent.sh` after source changes.

## Suggested Stardock checklist wrapper

If this plan is executed through Stardock, use one brief per implementation slice above. Keep this plan as the source of truth; do not duplicate all slice tasks into the Stardock task file. A thin checklist is sufficient:

- [ ] Add compact dogfood regression evidence.
- [ ] Make evidence/status schemas accept common dogfood language.
- [ ] Teach completion policy about accepted deferred blockers.
- [ ] Improve finalization and iteration lifecycle ergonomics.
- [ ] Add task-checklist and ledger drift reporting.
- [ ] Update docs, skill guidance, and dogfood notes.
- [ ] Run final typecheck, focused tests, link script, and summarize validation.
