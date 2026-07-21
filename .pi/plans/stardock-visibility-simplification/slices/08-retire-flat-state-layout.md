# 08: Delete Flat State Layout

## Goal

Delete legacy flat `.stardock/<name>.state.json` lookup/listing compatibility from the current state store. Existing flat or pre-v4 runs are disposable and are not imported or backed up.

## Dependencies and Treehouse lane

- Depends on Slice 06a state-retirement contract.
- Runs in parallel with Slice 07 as node `flat-layout-retirement`.
- Owns only `src/state/store.ts` and new `test/flat-state-retirement.test.ts`.
- Slice 08a owns `state/paths.ts`, runtime commands/registration, shared tests, and docs.

## Tasks

1. Change store `loadState`/`listLoops` to use nested schema-v4 state only; remove flat directory scans and precedence behavior.
2. Add disposable fixtures proving nested schema-v4 current/archive loading and deterministic rejection/non-discovery of flat/pre-v4 files.
3. Do not create an importer, backup manifest, inventory gate, or conflict resolver.
4. Return exact remaining command delete/path/help/doc removals to Slice 08a.
5. Commit cleanly and report base/head SHA, changed paths, validation, and integration notes.

## Acceptance criteria

- [ ] Store loading/listing never inspects flat paths.
- [ ] Nested schema-v4 current/archive state works.
- [ ] Flat/pre-v4 inputs are ignored or rejected without migration.
- [ ] No importer/backup/inventory artifact exists.
- [ ] Changed paths stay inside lane ownership and the worktree is clean.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/flat-state-retirement.test.ts \
  private/stardock/test/state-schema-v4.test.ts \
  private/stardock/test/lifecycle.test.ts
cd ../.. && rg -n 'legacyPath|\.state\.json|flat-state-importer' agent/extensions/private/stardock/src/state/store.ts
```

Expected signal: focused checks pass and store source has no flat lookup/import path.
