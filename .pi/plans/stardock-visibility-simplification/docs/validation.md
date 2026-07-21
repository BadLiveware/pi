# Stardock Visibility and Simplification Validation

## Purpose

Provide shared checks for the execution slices. Each slice runs its focused checks plus the broader checks required by its risk. The final slice runs the complete matrix.

## Deterministic commands

### TypeScript and structure

```bash
npm run typecheck --prefix agent/extensions
npm run check:structure --prefix agent/extensions
git diff --check -- agent/extensions/private/stardock agent/agents agent/skills .pi/plans/stardock-visibility-simplification
```

Expected signals:

- TypeScript exits 0 with no diagnostics.
- Structure guard passes without growing grandfathered large files.
- Diff check produces no output.

### Focused Stardock tests

Run from repository root:

```bash
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/index.test.ts \
  private/stardock/test/views.test.ts \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/prompt-lifecycle.test.ts \
  private/stardock/test/workflow-status.test.ts \
  private/stardock/test/workflow-gates.test.ts \
  private/stardock/test/brief-worker-runs.test.ts \
  private/stardock/test/worker-role-registry.test.ts \
  private/stardock/test/worker-reports.test.ts
```

Execution slices add their new focused test files to this command. Expected signal: all listed tests pass with zero failures.

### Full extension suite

```bash
npm test --prefix agent/extensions
```

Expected signal: structure check and the complete public/private extension test suite pass with zero failures.

### Linked layout

```bash
./link-into-pi-agent.sh
readlink /home/fl/.pi/agent/extensions
```

Expected signal: linking reports the extensions path already linked or newly linked, and `readlink` prints `/home/fl/code/personal/pi/agent/extensions`.

## Parallel stage and Treehouse tests

Add deterministic fake-adapter tests for:

- missing dependency, cross-stage dependency, and exact cycle reporting;
- deterministic topological ready-set and contract/fan-in role validation;
- normalized write-ownership overlap and disjoint lanes;
- exclusive/shared resource claims, unique allocations, conflicts, and declared serialization;
- frozen contract/base SHA verification;
- bounded concurrency and five-lane out-of-order completion;
- pre-created WorkerRuns and owner-token guarded stable-id completion updates;
- cross-process lock ownership, unauthorized mutation rejection, atomic revision updates, heartbeat/expiry, and approved takeover;
- current-workspace implementer remains serial while distinct Treehouse lanes run concurrently;
- lease acquisition partial failure and clean unused-lease return;
- dirty/uncommitted/out-of-ownership lane rejection;
- accepted clean lane branch/head evidence;
- integration-plan expected-parent-head ordering and conflict preflight;
- clean committed fan-in head, durable prepare token/evidence before parent movement, no-ff source ancestry/mapping, validation failure with untouched parent, successful fast-forward, and idempotent finalization after interruption;
- branch collisions creating new attempts without overwrites;
- reconcile/retry classification for clean committed, clean unchanged, dirty, missing, and inconsistent leases/refs;
- shutdown/cancellation preserving leases and detached attempt evidence;
- completion/pause/cancel/archive/clean/nuke and legacy stop/abandon gates preserve nonterminal ownership/lease evidence;
- kill-while-short-mutex-held recovery quarantines only a proven-dead matching lock and permits guarded reconciliation;
- dirty release refusal and no automatic `--force`;
- two runtime instances do not share controllers/stage activity.

Run the exact disposable Treehouse dogfood in Slice 00e using [`treehouse-runbook.md`](treehouse-runbook.md). The assertion helper must prove overlapping attempts, distinct lease/path/branch ids, exact owned paths/base SHA, accepted runs, prepared/finalized ancestry, released disposition, copied Stardock evidence, safe-default pool destruction, and temporary-root removal.

## Status selector tests

Add deterministic tests for:

- no active loop;
- active loop with no workers;
- locally attached serial worker with start-only activity;
- parallel stage with five attached lane workers and aggregate counts;
- current tool/tool count update;
- update for a different request id is ignored;
- persisted `running` run without local activity becomes display-state `detached` without state mutation;
- `needs_review` outranks a recent successful worker;
- failed/cancelled worker selection;
- active brief, integration-prepared/finalization, and workflow next action;
- bounded recent/review-needed collections;
- activity cleanup after success, failure, cancellation, loop switch, and session shutdown;
- fake clock elapsed-time rendering and timer disposal.

Tests must compare unstyled snapshot objects separately from renderer strings.

## UI and renderer tests

Use the Stardock test harness or a focused component harness to assert:

- extension/session initialization with an active or recoverable loop calls `setWidget("stardock", ...)` before any status/dashboard/state command or tool call;
- loop start/restore, worker start/update/finish, review/failure/detachment, stage/fan-in, pause, and completion refresh the widget automatically;
- the widget alone covers ordinary loop/stage progress, active workers, review/failure/detached state, and next action while footer extension status is hidden;
- no-active-loop state clears the widget, and session/runtime teardown leaves no refresh timer;
- widget is capped at six lines and prioritizes worker/review/failure/blocker/next-action information over reflection/outside-request trivia;
- footer extension status includes active worker/run context when width permits, but no critical fact is footer-only;
- footer truncation remains within terminal width;
- custom worker `renderCall` distinguishes brief/request/loop scope;
- partial renderer handles starting/running/current-tool updates;
- collapsed final renderer reports terminal state, changed-file count, report id, and output-ref count;
- expanded final renderer remains bounded and includes concrete paths/refs;
- `/stardock dashboard` preserves `/stardock status` list-all behavior and adds deeper evidence without being required to discover the widget's critical facts;
- a second runtime's durable review/failure/fan-in update refreshes an idle observer widget through bounded revision watching without an inspection action;
- pause retains a recoverable widget with resume/reconcile next action, and completion retains an in-session terminal snapshot until the next loop/session;
- notification deduplication does not suppress command errors or workflow-gate notifications.

Each rendered line must satisfy Pi TUI width rules using `visibleWidth()` or equivalent assertions.

## Worker bridge race tests

Use the existing fake event bus to cover:

- synchronous started event followed by updates and response;
- cancellation between start and update;
- response arriving after cancellation is ignored;
- update after response is ignored;
- bridge failure clears local activity and records a durable failed/cancelled outcome;
- started-without-response reaches the injected completion-watchdog timeout, emits cancellation, rejects/settles the promise, unsubscribes listeners, and leaves no controller/timer/activity leak;
- session shutdown cancels and settles an active bridge run before runtime teardown;
- two runtime instances do not share activity;
- a detached durable run owned by an unknown session is not rewritten.

## Hard state-cutover tests

### Schema v4 only

Fixtures:

- canonical checklist and recursive schema-v4 states;
- schema-v4 state with full ExecutionGraph/stage/node/attempt/integration evidence;
- missing, schema-v1, and schema-v3 versions;
- malformed schema-v4 input;
- fresh continuation-loop startup after pre-v4 state removal.

Expected signals:

- schema-v4 load/save/load preserves current fields and execution evidence;
- new JSON contains neither `active` nor `itemsPerIteration`;
- missing/pre-v4 input returns an unsupported/reset result and is never normalized or rewritten;
- no first-party source, global skill, template, test, or current doc emits removed pacing fields;
- cutover refuses while a stage/lease is nonterminal;
- a fresh schema-v4 continuation loop starts at Slice 06a and reconstructs the passive widget.

### Evolve and flat removal

Fixtures:

- current checklist/recursive schema-v4 state;
- disposable evolve/pre-v4 input;
- disposable flat `.state.json` input beside valid nested schema-v4 state.

Expected signals:

- only current checklist/recursive modes are accepted;
- evolve-specific types, parser branches, policy, and migration modules are absent;
- store/list/commands/path helpers never inspect, import, back up, migrate, or delete flat compatibility files;
- old/evolve/flat fixtures are rejected or ignored under the generic new-state-only policy;
- no flat importer or backup/inventory workflow exists.

## Tool taxonomy and dynamic loading tests

- fresh session without active loop exposes start, state, and loader while preserving non-Stardock active tools;
- active loop adds core tools;
- recursive loop adds attempt reporting;
- auditor/final-verification/breakout workflow status activates the required specialized group;
- loader query and explicit group both add registered tools;
- unknown query returns valid groups and adds nothing;
- activation is additive during the turn;
- followup to an inactive read capability succeeds through internal dispatch;
- a returned recommendation never names an unavailable direct tool without activating it or giving exact loader arguments;
- session reload reconstructs the correct active set;
- no-active-loop and active-loop metadata byte totals are reported against the Slice 00 baseline.

## Prompt-behavior validation

Run a `prompt-behavior-tester` after Slices 04, 05, and 09 with these scenarios:

1. A precise single-checkout brief requires implementation: agent chooses `stardock_worker`, not the removed wrapper or an explorer first.
2. A contract-frozen plan has three independent implementation nodes: agent builds/validates the DAG and uses `stardock_stage runReady` with Treehouse lanes rather than sequential workers or parallel writes in one checkout.
3. A lane discovers it must change the frozen interface: agent stops the lane and requests a contract update instead of editing the interface locally.
4. A mutation needs immediate overview: agent uses `followupTool` with `stardock_state` rather than removed `include*` flags.
5. A pending auditor gate names an inactive specialized tool: agent loads/uses the required group in one discoverable path.
6. A user asks to inspect a worker: agent uses state/dashboard/worker list rather than reading `.stardock` directly.
7. Pre-v4/evolve/flat state is found: agent reports the new-state-only cutover and restarts from durable plan context; it does not offer migration or coerce the run.
8. A user says stop: agent distinguishes pause from abandon and does not silently complete the loop.

Expected signal: all scenarios follow current names and lifecycle constraints; no deprecated surface appears in the recommended action.

## Live TUI dogfood

Use a disposable temporary repository and fake or bounded worker bridge; do not use a production repository for destructive command tests.

1. Start a checklist loop and activate a brief, then issue no status/dashboard/state inspection action. Verify the persistent widget appears automatically with loop/workflow/next-action context.
2. Run a read-only serial worker that emits at least two tool updates. Without invoking inspection, observe the widget move through starting/current-tool/finishing/review or terminal state.
3. Run a disposable two-or-more-lane Treehouse stage from one contract commit. Still without inspection actions, observe aggregate/lane, failure/review, fan-in-wait, prepared, and terminal widget updates.
4. Hide/omit extension footer status and verify the widget remains sufficient for ordinary awareness.
5. Run an implementer fixture that changes one disposable file and returns `needs_review`; verify the widget names review as the next action.
6. Only after passive behavior passes, open `/stardock dashboard` and state/worker views to verify deeper run ids, evidence refs, lane details, and fan-in arguments.
7. Accept lane runs, integrate in recorded order, record stage validation, and verify clean lease release.
8. Simulate persisted `running` lanes with no local activity and verify the restored widget says detached/last-known without state mutation or forced return.
9. Reload Pi without invoking a Stardock command and verify the widget reconstructs immediately, activity timers/controllers are gone, durable stage state is visible, and tool activation is reconstructed.

Record screenshots or terminal captures only when they materially help review; store paths as Stardock artifacts rather than embedding binary data in state.

## Optional Footer Framework integration

This is supplemental personalization, not a visibility acceptance gate. The persistent widget must already pass all passive-default tests with no footer configuration.

After explicit user approval, configure an adapter from `extensionStatus` key `stardock` using `footer_framework_adapter_config`, then inspect `footer_framework_state`.

Expected signals:

- rendered item id `stardock` is visible in the selected line/zone;
- active worker status appears without enabling the generic `ext` item;
- clearing the Stardock extension status removes the item;
- no Footer Framework source file is rewritten by Stardock.

## Final review

Run an independent auditor/reviewer over:

- status ownership and cancellation races;
- every public API compatibility gate and the hard state-cutover boundary;
- public tool/command/schema removals;
- dynamic-loading discoverability;
- docs/skills/agent capability alignment;
- full validation evidence.

A final supported finding blocks completion until fixed or explicitly deferred with rationale.
