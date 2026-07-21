# 02: Fan In and Wire User-visible Worker Status

## Goal

Review and integrate the five status implementation lanes, wire them into Stardock runtime/tool/commands, and validate the combined serial/parallel user experience.

## Dependencies

- Slice 01 contract commit.
- Lanes 01a–01e completed with clean commits and accepted WorkerRuns.

## Scope

In scope:

- Deterministic lane integration.
- Runtime/activity/snapshot wiring.
- Custom worker and stage tool rendering.
- Automatically registered and refreshed worker-aware persistent widget as the primary status surface.
- Supplemental extension status/tool rows/notifications and deeper dashboard wiring.
- Footer Framework adapter docs and optional approved personal configuration.
- Combined tests and live Treehouse dogfood.

Out of scope:

- Changing frozen contracts without restarting affected lanes.
- Automatic conflict resolution.
- Tool/schema cleanup.

## Affected areas

Fan-in owns shared wiring files forbidden to lanes:

- `agent/extensions/private/stardock/index.ts`
- `src/stardock-worker-tool.ts`
- `src/stages/` registration/render wiring
- `src/runtime/types.ts`
- `src/runtime/ui.ts`
- `src/runtime/commands.ts`
- workflow/worker notification wiring
- README, skill, agent profiles, integration tests

## Required references

- [`../design/status-snapshot-and-activity.md`](../design/status-snapshot-and-activity.md)
- [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)
- [`../docs/treehouse-runbook.md`](../docs/treehouse-runbook.md)
- [`../docs/validation.md`](../docs/validation.md)

## Tasks

1. Review every lane WorkerRun/report, changed paths, validation, and contract compliance. Reject or requeue lanes that edit forbidden/shared files or leave dirty/uncommitted worktrees.
2. Generate the stage integration plan, verify the parent still equals the recorded expected head, create the dedicated integration branch, and no-ff merge accepted lane branches in order: activity, selector, worker card, footer/widget, dashboard/notifications. Abort and record conflicts; do not auto-resolve.
3. Wire the activity/controller registry and snapshot selector into the runtime instance and worker/stage execution callbacks. Ensure multiple stage workers update one aggregate snapshot without any status command/tool call.
4. Register custom partial/final renderers for `stardock_worker` and `stardock_stage` using lane-owned components.
5. Register the persistent widget automatically, render immediately for the selected active/recoverable loop, and refresh on local events plus a low-frequency selected-state revision/mtime watcher for cross-runtime updates. Pause retains recoverable status; completion retains an in-session terminal snapshot until a new loop/session; a new session with no displayable loop clears it.
6. Publish supplemental footer/status from the same snapshot, but prove the widget remains sufficient when extension status is hidden. Add `/stardock dashboard [loop]` only as deeper inspection while preserving `/stardock status` list-all and `/stardock view` overview behavior.
7. Wire notification candidates through a separate tracker without suppressing command/lifecycle/workflow-gate notifications.
8. Resolve integration-only type/import/test-fixture issues without changing the frozen semantic contract. A real contract change creates a new contract commit and restarts impacted lanes.
9. Document the passive widget as the default zero-configuration experience. Document the Footer Framework adapter only as optional footer personalization.
10. Commit every fan-in-owned source/test/doc change, record ordered fan-in commits, and require the integration worktree clean.
11. Run combined status, bridge, stage, UI, lifecycle, workflow, typecheck, structure, and full extension tests on that committed integration head.
12. Call `prepareIntegration` to durably verify clean head, source ancestry/merge mappings, fan-in commits, validation, and unchanged parent. Run its fast-forward command, require exact parent result, finalize idempotently with `recordIntegrated`, then return clean leases.
13. Optionally apply the Footer Framework recipe only with explicit approval; this personal mutation is outside the integration commit and cannot gate acceptance because the widget requires no configuration.
14. Dogfood serial and five-lane fake activity without invoking status/dashboard/state tools during the passive-observation phase; only after widget behavior passes, use dashboard/tool views for deeper inspection. Run the disposable Treehouse stage through review, prepare, fast-forward, finalization, and release.

## Acceptance criteria

- [ ] Five lane branches integrate from one contract base with preserved source-head ancestry, exact merge mappings, and no hidden contract/parent drift.
- [ ] Starting or restoring a loop automatically installs a useful widget; serial/parallel progress, review/failure/detached state, and next action update without status/dashboard/state-tool calls or user configuration.
- [ ] Hiding extension footer status does not reduce the widget below the ordinary-awareness contract.
- [ ] An idle observer runtime updates after another runtime changes durable stage state, and pause/completion remain passively legible under the defined retention policy.
- [ ] Cards/footer/notifications add contextual detail, while dashboard/state/list/expanded views provide deeper inspection only.
- [ ] `/stardock status`, view, lifecycle, workflow gates, and serial worker behavior remain compatible.
- [ ] Combined tests pass against a clean committed integration head; lane-local or uncommitted passes are not integration proof.
- [ ] Stage is recorded integrated and all accepted clean leases are returned.
- [ ] Detached/interrupted leases remain visible and are never force-cleaned automatically.

## Validation

```bash
npm run typecheck --prefix agent/extensions
npm run check:structure --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/stages.test.ts \
  private/stardock/test/worker-activity.test.ts \
  private/stardock/test/worker-bridge-lifecycle.test.ts \
  private/stardock/test/worker-status-selector.test.ts \
  private/stardock/test/worker-tool-renderer.test.ts \
  private/stardock/test/worker-footer-widget.test.ts \
  private/stardock/test/worker-dashboard-notifications.test.ts \
  private/stardock/test/brief-worker-runs.test.ts \
  private/stardock/test/views.test.ts \
  private/stardock/test/lifecycle.test.ts
cd ../.. && npm test --prefix agent/extensions
treehouse status
```

Expected signal: all focused/full checks pass; status dogfood is recorded; accepted leases are returned; no unreviewed dirty lease is lost.

## Risks and split triggers

- If more than two lanes conflict with shared contract assumptions, stop fan-in and revise/re-freeze the contract rather than accumulating integration patches.
- Keep optional interactive dashboard overlay work out unless bounded text dashboard proves insufficient.
