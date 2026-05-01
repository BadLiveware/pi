# Stardock formal models

This directory contains small executable TLA+ models for critical Stardock state-machine behavior.

## Recursive lifecycle model

`StardockRecursiveLifecycle.tla` models the recursive-loop lifecycle around:

- `stardock_start`
- `stardock_done`
- completion marker handling
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
