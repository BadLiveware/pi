# 04a: Command Cleanup and API Migration Fan-in

## Goal

Review and integrate the parallel command-cleanup and first-party API-migration lanes, then update shared documentation/capability surfaces and produce the Slice 05 removal decision package.

## Dependencies

- Slice 02a cleanup/API contract committed and stage validated.
- Slices 03 and 04 completed in distinct Treehouse leases with accepted clean commits.

## Tasks

1. Review both lane diffs, tests, write ownership, and contract/replacement evidence.
2. Generate `integrationPlan`, verify parent head, and no-ff merge command cleanup first and API migration second on the dedicated integration branch. Abort/record conflicts; requeue rather than auto-resolving semantic overlap.
3. In fan-in-owned `src/runtime/prompts.ts`, delete `defaultReflectInstructions()` after reference confirmation and migrate every include-flag recommendation to canonical followup/preview behavior. Apply shared README/skill, delegation skill, profiles, architecture, and historical notices.
4. Verify current command help, workflow status, and prompt guidance name only canonical worker/payload/preview/followup paths.
5. Commit every fan-in-owned source/test/doc/capability change, record ordered fan-in commits, and require the integration worktree clean.
6. Run focused command, worker, brief, policy, prompt-behavior, typecheck, structure, and full extension validation on that committed head.
7. Call `prepareIntegration`; after durable verification, run its parent fast-forward, require exact result, finalize idempotently with `recordIntegrated`, and return both clean leases.
8. Produce the explicit Slice 05 go/no-go package: removed names/parameters, replacements, local usage evidence, residual external risk, and rollback commit.

## Acceptance criteria

- [ ] Both parallel lanes integrate in deterministic order and shared docs/capabilities match combined behavior.
- [ ] Command aliases preserve semantics and canonical API guidance has no first-party compatibility caller.
- [ ] Focused/full/prompt-behavior validation passes on a clean committed integration head.
- [ ] Both leases are returned only after integration is recorded.
- [ ] Slice 05 decision package is complete enough for explicit user approval.

## Validation

```bash
npm run typecheck --prefix agent/extensions
npm run check:structure --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/interrupt-input.test.ts \
  private/stardock/test/advisory-adapters.test.ts \
  private/stardock/test/brief-worker-runs.test.ts \
  private/stardock/test/briefs.test.ts \
  private/stardock/test/policy.test.ts
cd ../.. && npm test --prefix agent/extensions
```

Expected signal: combined validation passes and `stardock_stage` records the cleanup/API stage integrated.
