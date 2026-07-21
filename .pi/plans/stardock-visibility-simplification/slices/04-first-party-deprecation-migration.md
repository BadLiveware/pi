# 04: First-party Deprecation Migration

## Goal

Migrate lane-owned first-party prompt, policy, implementation, and test paths to canonical worker/followup APIs, and produce an exact shared skill/profile/documentation change manifest for the fan-in.

## Dependencies and Treehouse lane

- Depends on Slice 02a cleanup/API contract commit and validated stage.
- Runs in parallel with Slice 03 as lane `api-migration`.
- Owns worker/advisory/brief/followup/policy implementation and focused tests assigned by the stage contract.
- Shared README/skill/agent-profile/architecture/historical-plan files are fan-in-owned and forbidden in this lane.

## Scope

In scope:

- Replacement contract for advisory dry-run/payload inspection.
- Migration from `stardock_brief_worker` to `stardock_worker`.
- Migration from `stardock_advisory_adapter` to canonical brief/worker behavior.
- Migration from `includeState`, `includeOverview`, and `includePromptPreview` to `followupTool` or explicit bounded read actions.
- Temporary deprecation descriptions/results.

Out of scope:

- Deleting compatibility tools/parameters; Slice 05 owns deletion.
- Dynamic activation.
- Persisted state changes.

## Affected areas

- `src/subagent-readiness-policy.ts`
- `src/brief-worker-runs.ts`
- `src/advisory-adapters.ts`
- `src/stardock-worker-tool.ts`
- `src/runtime/core-tools.ts`, `src/runtime/followups.ts`, `src/workflow-status.ts`, mutation tool schemas
- Lane-owned tests
- Shared Stardock README/skill, `agent/skills/subagent-delegation/SKILL.md`, agent profiles, and historical notices are manifest outputs applied only by Slice 04a

## Required references

- [`../docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)
- [`../docs/validation.md`](../docs/validation.md)
- [`../design/tool-taxonomy-and-loading.md`](../design/tool-taxonomy-and-loading.md)

## Tasks

1. Add `stardock_worker({ action: "payload", ...scope/role/model/thinking inputs })` as the canonical inspect-before-run replacement. It must reuse the same invocation builder as `action: "run"`, perform no execution or WorkerRun mutation, and return the bounded Stardock-owned role/scope invocation plus saved-output defaults. Migrate advisory-adapter explorer/test-runner payload tests to this action.
2. Change `subagent-readiness-policy.ts` and every first-party recommendation from `stardock_brief_worker` to `stardock_worker` with the exact review action/arguments.
3. Produce the exact changes required in `agent/skills/subagent-delegation/SKILL.md`, Stardock skill/README, agent capability profiles, and architecture diagrams; the parent fan-in applies them after both lanes integrate.
4. Replace lane-owned first-party `includeState` and `includeOverview` callers with `followupTool` using `stardock_state` summary/overview and an explicit attachment mode. Return exact `runtime/prompts.ts` edits to Slice 04a.
5. Add read-only `stardock_brief({ action: "preview", briefId?, loopName? })` and register it as a supported read-only followup. It returns the selected/current brief identity plus the same bounded iteration-prompt preview previously produced by `includePromptPreview`, capped at 4,000 characters, and never mutates brief/loop state. Migrate every preview caller to this action.
6. Update tests to exercise the canonical APIs. Retain a small compatibility test proving wrapper/adapter/include inputs either delegate or return a precise deprecation/replacement message during this slice.
7. Mark wrapper/adapter/include parameters deprecated in source descriptions. Return shared-doc and historical-notice edits to the parent fan-in; do not add deprecated names to new prompt guidelines.
8. Run source-level/focused behavior tests and prepare prompt-behavior scenarios for combined fan-in validation.
9. Commit a clean lane branch and report base/head SHA, changed paths, validation, replacement evidence, and shared-doc/capability integration notes.

## Acceptance criteria

- [ ] No lane-owned policy, prompt, implementation, or current test recommends a compatibility wrapper/adapter/include flag; the exact remaining shared-file edits are listed for Slice 04a.
- [ ] `stardock_worker action=payload` provides the canonical bounded no-execution invocation for every supported role/scope.
- [ ] `stardock_brief action=preview` provides the canonical read-only 4,000-character iteration preview and works through `followupTool`.
- [ ] Immediate post-mutation state/overview/preview workflows work through followups or explicit bounded reads.
- [ ] Compatibility surfaces still execute or emit an exact replacement message in this slice.
- [ ] Prompt-behavior tests choose canonical names in all named scenarios.
- [ ] Tool capability profiles reflect the canonical surface.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/advisory-adapters.test.ts \
  private/stardock/test/brief-worker-runs.test.ts \
  private/stardock/test/briefs.test.ts \
  private/stardock/test/worker-reports.test.ts \
  private/stardock/test/policy.test.ts
cd ../.. && rg -n 'stardock_brief_worker|stardock_advisory_adapter|includeOverview|includeState|includePromptPreview' \
  agent/extensions/private/stardock agent/agents agent/skills
```

Expected signal: tests pass; remaining hits are compatibility implementation/tests, explicitly historical text, and the exact fan-in-owned `runtime/prompts.ts` edits recorded for Slice 04a.

## Risks and split triggers

- Split the worker dry-run/payload action into its own slice if it requires a new public result contract rather than a local action on the existing worker tool.
- Do not delete the old paths in the same commit; Slice 05 is the rollback checkpoint.
