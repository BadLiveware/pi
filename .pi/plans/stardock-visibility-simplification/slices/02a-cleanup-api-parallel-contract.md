# 02a: Cleanup/API Parallel Contract

## Goal

Freeze the exact shared contract, ownership, resources, briefs, and base SHA for running Slices 03 and 04 concurrently.

## Dependencies

- Slice 02 status fan-in integrated and validated.
- Slices 00a–00e parallel foundation complete.

## Tasks

1. Re-run Slice 00 state/tool/command inventories against the integrated status code.
2. Freeze public command/tool/schema compatibility expectations used by both lanes.
3. Create the Slice 03 and Slice 04 briefs with exact acceptance/validation and contract-change stop rules.
4. Record disjoint ownership:
   - Slice 03 owns command-registration/dead-code source and focused tests only.
   - Slice 04 owns first-party callers/tests/examples/docs/capability profiles only.
   - `src/runtime/prompts.ts` plus shared README/skill/capability/taxonomy decisions remain Slice 04a fan-in-owned because prompt helper deletion and include-flag migration touch the same file.
5. Record resource claims and unique values/serialization for all tests.
6. Commit any shared source/test contract preparation, then upsert briefs/stage with canonical digests using that exact parent commit as `integrationBaseCommit` and `contractCommit`.
7. Validate DAG/readiness and run no workers yet.

## Acceptance criteria

- [ ] Slices 03/04 have explicit disjoint write/resource ownership and exact briefs.
- [ ] Shared files are fan-in-owned, not optimistically assigned to both lanes.
- [ ] Stage base/contract are one exact committed SHA and parent head matches.
- [ ] `stardock_stage list` reports both nodes ready and no validation conflicts.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/commands.test.ts \
  private/stardock/test/tool-contract.test.ts
```

Expected signal: contract fixtures pass and both implementation nodes are ready for `runReady`.
