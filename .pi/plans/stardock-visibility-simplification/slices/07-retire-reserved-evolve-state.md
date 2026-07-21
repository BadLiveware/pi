# 07: Delete Reserved Evolve State

## Goal

Delete speculative evolve mode/state/types from current production code. No legacy evolve file detector, migration, or preservation path remains.

## Dependencies and Treehouse lane

- Depends on Slice 06a state-retirement contract.
- Runs in parallel with Slice 08 as node `evolve-retirement`.
- Owns exactly `src/state/{core,evolve,modes,migration}.ts`, `src/runtime/{core-tools,prompts}.ts`, `src/subagent-readiness-policy.ts`, and evolve-only tests.
- Runtime commands/index, shared lifecycle tests, README/skill/architecture/historical files are Slice 08a-owned and forbidden.

## Scope

In scope:

- Remove evolve from current mode/type/schema/prompt/policy contracts.
- Delete speculative candidate/evaluator/archive types and modules.
- Remove evolve-specific tests; retain current checklist/recursive tests.

Out of scope:

- Detecting, loading, migrating, or explaining old evolve state beyond the generic pre-v4 rejection from Slice 06.
- Implementing evolve.

## Tasks

1. Remove evolve from writable/current LoopMode and ModeState unions, start schemas, mode constructors, prompt dispatch, defaults, and policy gates.
2. Delete `state/evolve.ts`, candidate/evaluator/archive types, constants, and migration branches after current-source reference checks.
3. Replace reserved-mode tests with tests proving only checklist/recursive are accepted in schema-v4 state and tool/command schemas.
4. Return exact shared command-help/current-doc/historical-notice edits to Slice 08a without editing fan-in-owned files.
5. Commit cleanly and report base/head SHA, changed paths, validation, and integration notes.

## Acceptance criteria

- [ ] Current public schemas expose only implemented modes.
- [ ] Writable schema-v4 state has no evolve model or branch.
- [ ] No evolve-specific legacy detector/migration remains.
- [ ] Checklist and recursive behavior remains unchanged.
- [ ] Changed paths stay inside lane ownership and the worktree is clean.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/state-schema-v4.test.ts \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/recursive.test.ts \
  private/stardock/test/prompt-lifecycle.test.ts
cd ../.. && rg -n '\bevolve\b|Evolve' agent/extensions/private/stardock/src
```

Expected signal: tests pass and current production source has no evolve mode/type/migration path.
