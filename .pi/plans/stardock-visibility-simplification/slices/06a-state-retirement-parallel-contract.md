# 06a: State-retirement Parallel Contract

## Goal

From a fresh schema-v4 loop, freeze exact disjoint ownership, briefs, resources, and base SHA for concurrently deleting reserved evolve code and flat-layout compatibility code.

## Dependencies

- Slice 06 hard cutover integrated and validated.
- Fresh schema-v4 continuation loop is active.
- Slices 00a–00e parallel foundation is available in the new schema.

## Tasks

1. Re-run current source/test reference maps for evolve and flat-layout branches; old run files are not inventory or migration inputs.
2. Freeze the new-state contract both lanes preserve: checklist/recursive schema-v4 state, ExecutionGraph evidence, nested current paths, and passive UI behavior.
3. Create Slice 07 and Slice 08 briefs with exact acceptance/validation and contract-change stop rules.
4. Record exact disjoint ownership:
   - Slice 07 owns `src/state/{core,evolve,modes,migration}.ts`, `src/runtime/{core-tools,prompts}.ts`, `src/subagent-readiness-policy.ts`, and evolve-only tests.
   - Slice 08 owns `src/state/store.ts` and flat-reader-removal tests.
   - Slice 08a owns `src/state/paths.ts`, `src/runtime/commands.ts`, registration/index wiring, shared lifecycle tests, and shared docs/capabilities.
5. Record isolated fixture roots/resource claims. Fixtures create only disposable schema-v4 nested state plus explicitly rejected old/flat inputs.
6. Commit shared source/test contract preparation, then upsert briefs/stage with canonical digests using that exact commit as integration/contract base.
7. Validate DAG/readiness; run no workers yet.

## Acceptance criteria

- [ ] Slices 07/08 have disjoint write and test-resource ownership.
- [ ] No task requests backup, import, migration, or approval for pre-change state.
- [ ] Shared files are owned by Slice 08a.
- [ ] Exact contract/base SHA is committed and parent head matches.
- [ ] Both nodes are ready with no graph/resource conflict.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/state-schema-v4.test.ts \
  private/stardock/test/lifecycle.test.ts
```

Expected signal: the fresh state contract passes and both removal nodes are ready for `runReady`.
