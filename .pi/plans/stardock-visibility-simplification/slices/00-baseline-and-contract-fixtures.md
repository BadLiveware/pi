# 00: Baseline and Contract Fixtures

## Goal

Create reproducible evidence and public-contract fixtures before changing worker status, tools, commands, or the disposable persisted-state format.

## Scope

In scope:

- Fresh status-path, tool-metadata, session-use, and current state-code measurements.
- Test fixtures that preserve command, worker bridge, and tool-registration contracts needed by later slices.
- A current map of source/docs/skills/agent profiles/historical plans referencing removal candidates.

Out of scope:

- User-visible status changes.
- Deprecation or deletion.
- State cutover or tool activation changes.

## Affected areas

- `agent/extensions/private/stardock/test/`
- `agent/extensions/private/stardock/src/`
- `agent/extensions/private/stardock/README.md`
- `agent/extensions/private/stardock/skills/stardock/SKILL.md`
- `agent/agents/`
- `agent/skills/`
- `.pi/plans/stardock-*.md`
- [`../docs/evidence-baseline.md`](../docs/evidence-baseline.md)
- [`../docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)

## Required references

- [`../docs/evidence-baseline.md`](../docs/evidence-baseline.md)
- [`../docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)
- [`../docs/validation.md`](../docs/validation.md)

## Tasks

1. Record `treehouse --version`, `treehouse status`, config presence, installed `get --lease`/`return`/`destroy` help, and repository cleanliness. The observed planning baseline has `/usr/bin/treehouse`, no pool worktrees, and no repository `treehouse.toml`.
2. Run the tool metadata script and record registered tool count, per-tool bytes, and total bytes as a compact command artifact.
3. Inventory current state source paths and aggregate local file shapes only as implementation context. Do not build a migration/backup gate or treat existing run files as acceptance inputs.
4. Search session transcripts, current source, tests, README, skills, agent profiles, architecture docs, and historical Stardock plans for every compatibility-matrix surface. Record observed usage and first-party callers; distinguish zero observed usage from proof of absence.
5. Add a deterministic tool-surface test that records current registered names and allows later slices to update the expected taxonomy deliberately rather than accidentally.
6. Record current schema/field behavior in a bounded baseline test or artifact so Slice 06 can prove deliberate deletion; do not create compatibility fixtures that must survive cutover.
7. Add bridge fixtures that emit start, multiple tool updates, response, cancellation, and bridge failure. Keep them transport-focused; status behavior lands in Slice 01.
8. Add command tests that lock `/stardock status` as list-all, `/stardock list --archived` as archive-specific, and current pause/force-complete semantics before aliases are clarified.
9. Update the evidence baseline only when fresh measurements differ; include measurement date and command, not interpretation that belongs in execution slices.

## Acceptance criteria

- [ ] Tool metadata, current state-code shape, session-use evidence, and reference inventory have reproducible commands/artifacts.
- [ ] Worker bridge, command semantics, and tool-registration fixtures pass before behavior changes.
- [ ] Every public-surface matrix row has a verified first-party reference set or explicit no-reference result.
- [ ] No production behavior or public schema changes in this slice.
- [ ] Evidence artifacts avoid embedding private absolute path lists in model-facing state.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/index.test.ts \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/brief-worker-runs.test.ts
cd ../.. && git diff --check -- agent/extensions/private/stardock .pi/plans/stardock-visibility-simplification
```

Expected signal: all focused tests pass; measurements are recorded; production source changes are limited to testability hooks only if required and are behavior-neutral.

## Risks and split triggers

- Session transcript counts may repeat calls across branches/copies; retain the caveat in the artifact.
- Split a separate test-infrastructure slice before continuing if bridge fixtures require changes beyond a bounded fake event bus or existing harness extension.
