# 08a: Evolve and Flat-state Removal Fan-in

## Goal

Integrate the evolve and flat-layout removal lanes, delete remaining shared compatibility wiring/docs, and prove the fresh schema-v4-only runtime before dynamic tool loading.

## Dependencies

- Slice 06a state-retirement contract committed and validated.
- Slice 07 and Slice 08 WorkerRuns accepted with clean commits.

## Fan-in ownership

- `src/state/paths.ts`
- `src/runtime/commands.ts` and registration/index wiring
- shared lifecycle/recursive/prompt tests
- command help, README/skill, architecture diagrams, capability profiles, and historical notices

## Tasks

1. Review lane diffs, write ownership, current-state fixtures, and rollback points.
2. Generate `integrationPlan`, verify parent head, and no-ff merge evolve first and flat-layout second on the dedicated integration branch. Abort/requeue semantic conflicts.
3. Remove remaining `legacyPath` exports/callers, flat delete branches, evolve help/registration references, and shared test/doc references.
4. Commit every fan-in-owned source/test/doc change, record ordered fan-in commits, and require a clean integration worktree.
5. Run schema-v4, current checklist/recursive, flat/evolve absence, typecheck, structure, and full extension validation.
6. Call `prepareIntegration`; fast-forward only after durable verification, finalize with `recordIntegrated`, then return clean leases.
7. Freeze the surviving public tool taxonomy and new-state-only assumptions consumed by Slice 09.

## Acceptance criteria

- [ ] Current runtime has no evolve mode and no flat state path/importer.
- [ ] Only fresh nested schema-v4 runs are supported.
- [ ] Current checklist/recursive lifecycle and passive UI tests pass.
- [ ] Full validation passes on a clean committed integration head.
- [ ] Surviving tool taxonomy is recorded before dynamic loading.

## Validation

```bash
npm run typecheck --prefix agent/extensions
npm run check:structure --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/state-schema-v4.test.ts \
  private/stardock/test/flat-state-retirement.test.ts \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/recursive.test.ts \
  private/stardock/test/prompt-lifecycle.test.ts
cd ../.. && npm test --prefix agent/extensions
rg -n '\bevolve\b|legacyPath|flat-state-importer' agent/extensions/private/stardock/src
```

Expected signal: focused/full checks pass; current source has no evolve/flat compatibility path; stage is integrated and leases returned.
