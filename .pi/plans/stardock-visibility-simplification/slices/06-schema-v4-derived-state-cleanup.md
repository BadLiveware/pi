# 06: Schema v4 Hard State Cutover

## Goal

Replace the pre-change run-state format with a schema-v4-only model that omits `active` and `itemsPerIteration`. Existing active, paused, completed, archived, evolve, and flat-layout run state is unsupported and may be discarded; no migration or mixed-version downgrade contract is retained.

## Scope

In scope:

- Hard schema-v4 parser/writer contract.
- Deterministic rejection of pre-v4 state with concise reset/restart guidance.
- Removal of `active` and `itemsPerIteration` from state, public inputs, prompts, tests, global skills, and docs.
- Durable execution handoff from the pre-cutover implementation loop to a fresh schema-v4 loop.

Out of scope:

- Preserving or migrating any pre-change run.
- Loading state written by an older Stardock after cutover.
- Evolve and flat-path source removal; Slices 07–08 own those code paths.

## Affected areas

- `src/state/core.ts`, `src/state/store.ts`, `src/state/migration.ts` or its replacement parser
- `src/runtime/args.ts`, `commands.ts`, `core-tools.ts`, `prompts.ts`, `lifecycle.ts`
- `src/views.ts`
- Stardock README/skill and global `agent/skills/planning/` and `agent/skills/execute-plan/` guidance
- state/lifecycle/prompt/workflow tests and historical notices

## Required references

- [`../docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)
- [`../docs/validation.md`](../docs/validation.md)
- Slice 00 evidence baseline

## Tasks

1. Before changing the reader, require every Treehouse stage integrated/abandoned and every lease returned. Export compact criteria/reports/artifact refs and current checklist position outside `.stardock`.
2. Checkpoint the pre-cutover implementation loop at the exact continuation point (`Slice 06a`), then pause/abandon it for disposal. Do not mark the overall plan complete while downstream work remains. Preserve only non-state artifacts the parent needs.
3. Define schema version 4 as the only accepted writable/readable run schema. Reject missing or `<4` schema versions with a concise unsupported-state/reset message; never coerce old data into a current loop.
4. Remove `active` and `itemsPerIteration` from canonical state, construction, save, lifecycle, summaries, command/tool schemas, prompts, tests, README/skill, global planning/execute-plan skills, and reusable loop templates.
5. Replace pacing text with brief/attempt scoping guidance; do not introduce another numeric pacing knob.
6. Delete schema-v1/v3 migration/default branches and compatibility fixtures that exist only to preserve old runs. Keep tests for malformed schema-v4 input and safe rejection.
7. Ensure `saveState()` writes only schema v4 and atomic current-state data, including ExecutionGraph/stage/node/attempt/integration fields created by Slices 00a–00e.
8. Commit and validate the cutover using project-native checks outside the disposed Stardock loop; record old-run/mixed-version downgrade as unsupported in current docs.
9. After the validated cutover commit is the current parent HEAD, discard the repository's pre-v4 `.stardock` state, start a fresh schema-v4 loop from `stardock-checklist.md` at Slice 06a, and verify passive widget reconstruction.

## Acceptance criteria

- [ ] No active Treehouse stage or lease exists at cutover.
- [ ] New state contains schema version 4 and neither removed field.
- [ ] Pre-v4/missing-version state is rejected and never partially normalized or rewritten.
- [ ] No first-party source, test, README, Stardock skill, planning skill, execute-plan skill, template, or agent guidance emits `itemsPerIteration`.
- [ ] Lifecycle and public summaries compile without `LoopState.active`.
- [ ] A fresh schema-v4 continuation loop resumes at Slice 06a from durable plan/artifact context, not migrated state.
- [ ] Downgrading to an older writer after cutover is explicitly unsupported; rollback means discard/restart, not preserve new run state.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/prompt-lifecycle.test.ts \
  private/stardock/test/workflow-status.test.ts \
  private/stardock/test/state-schema-v4.test.ts
cd ../.. && rg -n 'itemsPerIteration|items-per-iteration|state\.active|active:' \
  agent/extensions/private/stardock agent/skills/planning agent/skills/execute-plan agent/agents
```

Expected signal: typecheck/tests pass; pacing references are absent; `active` matches are only semantic status text or explicit old-schema rejection fixtures; a fresh schema-v4 loop restores passively.

## Risks and split triggers

- Do not cut over while a stage owns leases or prepared integration evidence.
- If preserving old runs becomes a requirement, stop and design a separate migration product; do not reintroduce opportunistic compatibility into this slice.
