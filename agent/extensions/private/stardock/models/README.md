# Stardock formal models

This directory contains small executable TLA+ and Lean models for critical Stardock state-machine behavior.

> The recursive lifecycle model covers the retained planless legacy compatibility path. New finite bounded work uses the governor-controlled execution-plan surface; new open-ended work uses the runner-neutral attempt loop unless a human explicitly enables legacy recursive Stardock.

## Retry and ownership recovery (Lean)

`StardockRetryRecovery.lean` retains the pre-fix retry/acquisition/recovery counterexamples and checks the repaired guards:

- selected ready work can reacquire custody beside decided siblings
- interrupted retries reconstruct unresolved lanes without rewriting accepted, integrated, or abandoned decisions
- confirmed-dead recovery with exact never-dispatched evidence clears active flags atomically while preserving leases
- live owners, unknown or dispatch-committed active workers, and unverifiable identity remain blocked
- the modeled invocation boundary implies dispatch commitment before launch

Run from the repository root with Lean 4 (checked with 4.27.0):

```bash
lean agent/extensions/private/stardock/models/StardockRetryRecovery.lean
node --experimental-strip-types --test agent/extensions/private/stardock/test/lean-lifecycle-model.test.ts
```

The Node test skips explicitly when Lean is unavailable. A successful Lean check prints the retained counterexamples and theorem axioms without errors or `sorry` declarations.

This is not a refinement proof of the implementation. The abstraction assumes valid dependencies/contracts and summarizes exact custody, revision, mutex, latest-attempt, run/report, and lease-identity checks as Boolean evidence. Real filesystem and transport boundaries are covered by `execution-plan-retry-lifecycle.test.ts` and `prepared-work-recovery.test.ts`, using subprocess owners, temporary roots, and synthetic leases rather than live Treehouse workers.

Legacy attempts without a dispatch marker remain unknown. Dispatch-committed attempts remain potentially launched even if the crash occurred immediately before transport; neither the model nor recovery claims inactivity from owner death alone.

## Recursive lifecycle model

`StardockRecursiveLifecycle.tla` models the recursive-loop lifecycle around:

- `stardock_start`
- `stardock_done`
- `stardock_complete` handling
- pause/stop completion transitions
- attempt placeholder/report state
- governor cadence and stagnation/scaffold outside-request creation
- active brief lifecycle actions applied by `stardock_done`

The model is intentionally a bounded abstraction. It checks lifecycle safety properties such as:

- runtime current-loop reference matches active status
- queued prompts only exist for active loops
- completed/paused loops have no queued prompt and no current-loop ref
- active iterations stay inside the configured range
- attempt records and outside requests only refer to reached iterations
- pending attempt placeholders only exist for iterations already advanced past
- active briefs only exist while a loop is active

The active-brief invariant captures the lifecycle policy that normal loop completion completes the active brief, while manual stop, max-iteration stop, and task-read-failure pause clear the brief back to draft.

Run the passing safety model with:

```bash
tlc -cleanup -config agent/extensions/private/stardock/models/StardockRecursiveLifecycle.cfg \
  agent/extensions/private/stardock/models/StardockRecursiveLifecycle.tla
```

Run only the brief-lifecycle invariant focus config with:

```bash
tlc -cleanup -config agent/extensions/private/stardock/models/StardockRecursiveLifecycleStrictBrief.cfg \
  agent/extensions/private/stardock/models/StardockRecursiveLifecycle.tla
```

The strict config should now pass; it is kept as a small regression target for the active-brief lifecycle policy.

Current default model constants:

```tla
MaxIterations = 3
GovernorIterations = {2}
OutsideHelpOnStagnation = TRUE
```

## Abstraction boundary

Included:

- recursive mode only
- one loop instance
- one abstract active/current brief
- a Boolean queued-prompt state instead of actual Pi message queues
- finite iteration-indexed attempt/request state
- task-file readability as a Boolean fault

Excluded:

- checklist/evolve modes
- durable JSON migration and archive paths
- full criterion ledger, verification artifacts, reports, handoffs, breakout packages, and policies
- exact prompt text and UI rendering
- timestamps, filesystem contents, and TypeScript schema validation
- real provider/subagent execution, which Stardock currently keeps out of scope

Use this model as a design check for lifecycle invariants, not as a replacement for TypeScript tests.
