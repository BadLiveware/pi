# 09: Dynamic Stardock Tool Loading

## Goal

Reduce Stardock's globally active tool metadata while preserving one-step discovery, active-loop operation, policy recommendations, followups, and specialized workflow capabilities.

## Dependencies

- Slice 08a state-retirement fan-in integrated and validated.
- Final surviving tool taxonomy, names, capability groups, and compatibility assumptions recorded.

## Scope

In scope:

- Final tool taxonomy measurement.
- `stardock_load_tools` capability router.
- Session/loop/mode/workflow-based additive activation.
- Followup and recommendation behavior for inactive public tools.
- Prompt-behavior and metadata regression tests.

Out of scope:

- Deleting additional capabilities based only on low frequency.
- Replacing vertical-slice tools with one mega-tool.
- Provider-specific deferred-loading protocol code; Pi owns that behavior.

## Affected areas

- New tool-loading vertical slice
- `agent/extensions/private/stardock/index.ts`
- runtime session hooks and workflow transition integration
- tool registration/activation tests and harness support
- README, skill, agent profiles, tool descriptions

## Required references

- [`../design/tool-taxonomy-and-loading.md`](../design/tool-taxonomy-and-loading.md)
- [`../docs/evidence-baseline.md`](../docs/evidence-baseline.md)
- [`../docs/validation.md`](../docs/validation.md)
- Completed Slices 04–05 final taxonomy

## Tasks

1. Recompute registered tool names and metadata bytes after all removals. Update group membership to actual surviving names without reviving deprecated aliases.
2. Add `stardock_load_tools` as an always-active additive loader with explicit group and capability-query inputs, bounded matches, valid-group guidance, and structured active/added results.
3. On session start/reload, preserve non-Stardock active tools and select the no-loop or active-loop core set defined in the design note.
4. Auto-activate recursive tools for recursive mode and specialized tools directly required by workflow status, pending outside requests, or explicit policy next actions.
5. Before returning a recommendation for an inactive direct tool, activate it when safe or return exact loader arguments. Verify the immediately following model request can call the tool.
6. Keep internal `followupTool` reads working when the corresponding public direct tool is inactive. If the followup result requires a mutation next, return the group/tool load route.
7. Avoid removing tools during an active turn. Let activation accumulate for the session and reset from state on reload/new session.
8. Extend the test harness with `getActiveTools`, `getAllTools`, and `setActiveTools` behavior that preserves other extensions' tools.
9. Add tests for no-loop startup, active checklist, active recursive, auditor/final/breakout gates, explicit loader query/group, unknown query, additive activation, followup, recommendation, reload, and non-Stardock preservation.
10. Measure no-loop, active-core, and specialized incremental metadata. Target at least 60% no-loop reduction from the fresh Slice 00 baseline; report actual bytes and discoverability evidence.
11. Update README/skill/agent profiles and run prompt-behavior scenarios so agents use the loader only when a required capability is inactive.
12. Run full tests, linked layout verification, and live TUI dogfood with a specialized gate reached after startup.

## Acceptance criteria

- [ ] No-loop sessions expose start, state, and a discoverable loader while preserving non-Stardock tools.
- [ ] Active loops receive all common lifecycle/brief/ledger/worker/policy capabilities without manual loading.
- [ ] Recursive and workflow-gated specialized capabilities activate automatically when required.
- [ ] Explicit loader queries add the correct registered tools in one call and never remove sibling tools.
- [ ] Followup and policy paths never strand the agent with an unavailable next tool.
- [ ] No-loop metadata is reduced by at least 60% from the fresh baseline, or the measured shortfall is explicitly reviewed without hiding capabilities.
- [ ] All tools remain registered and rollback to all-active requires no state migration.
- [ ] Prompt-behavior and live dogfood prove discoverability across at least one auditor/final/breakout path.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/tool-loading.test.ts \
  private/stardock/test/index.test.ts \
  private/stardock/test/policy.test.ts \
  private/stardock/test/workflow-status.test.ts \
  private/stardock/test/prompt-lifecycle.test.ts
cd ../.. && npm test --prefix agent/extensions
./link-into-pi-agent.sh
readlink /home/fl/.pi/agent/extensions
```

Expected signal: all suites pass; active-set tests preserve other tools; byte report shows baseline/current values; linked layout points into this repository.

## Risks and split triggers

- If Pi active-tool behavior differs from documented additive loading in the current installed version, stop after a bounded API spike and revise the design before broad activation changes.
- Split provider/cache benchmarking out only if metadata reduction passes functionally but request-prefix behavior cannot be explained by existing Pi tests/docs.
