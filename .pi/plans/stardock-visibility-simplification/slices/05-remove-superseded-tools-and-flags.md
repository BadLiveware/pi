# 05: Remove Superseded Tools and Response Flags

## Goal

Delete compatibility-only worker/adapter tools and bespoke mutation response flags after every first-party path uses the proven replacements.

## Dependencies

- Slice 04a cleanup/API fan-in integrated and validated.
- Explicit user go/no-go approval recorded from the 04a decision package.

## Scope

In scope:

- Remove `stardock_brief_worker` registration/wrapper.
- Remove `stardock_advisory_adapter` registration/module when its replacement is complete.
- Remove `includeOverview`, `includeState`, and `includePromptPreview` from public schemas and optional details plumbing.
- Remove obsolete tests/docs/capability entries.
- Update tool-surface baseline.

Out of scope:

- Removing single-item mutation forms.
- Removing low-frequency but purposeful evidence tools.
- Persisted state changes.
- Dynamic activation.

## Affected areas

- `src/brief-worker-runs.ts`
- `src/advisory-adapters.ts`
- `src/runtime/feature-tools.ts`
- `src/runtime/types.ts`, `index.ts`, optional detail helpers
- brief/ledger/report/auditor/handoff/breakout/final-report schemas
- tests, README, skill, agent profiles, historical notices

## Required references

- [`../docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)
- Slice 04 validation evidence
- [`../docs/validation.md`](../docs/validation.md)

## Tasks

1. Re-run the external compatibility gate searches and local session-use evidence. Block deletion if a current first-party caller remains or new local usage lacks a replacement.
2. Present the residual breaking-contract evidence to the user: removed tool/parameter names, local usage result, replacement calls, unknown external-caller risk, and one-commit rollback. Require explicit go/no-go approval before deleting any public tool or parameter; if approval is withheld, stop after Slice 04 with deprecations intact.
3. Delete `stardock_brief_worker` registration and wrapper module; remove its dedicated compatibility tests and keep equivalent canonical worker tests.
4. Delete `stardock_advisory_adapter` registration/module after the approved `stardock_worker action=payload` replacement passes; otherwise stop rather than partially deleting it.
5. Remove `includeOverview`, `includeState`, and `includePromptPreview` parameters from mutation schemas, dependency interfaces, `optionalLoopDetails`, and docs. Preserve `followupTool`, `stardock_brief action=preview`, and bounded list/state contracts.
6. Remove stale prompt guidelines, README rows, skill prose, capability profile entries, and current architecture diagrams.
7. Update historical plan notices so searches distinguish old design from current behavior.
8. Update the deterministic tool-registration expectation and serialized metadata measurement.
9. Run prompt-behavior tests and the full extension suite before treating deletion as complete.

## Acceptance criteria

- [ ] Explicit user go/no-go approval for the named breaking removals is recorded after Slice 04 evidence and before deletion.
- [ ] Removed tools are absent from registration, schemas, prompt metadata, current docs/skills, and agent profiles.
- [ ] Removed include flags are absent from every public mutation schema and first-party caller.
- [ ] Canonical worker, brief payload, followup, preview, and evidence workflows retain equivalent behavior.
- [ ] Single-item/batch mutation ergonomics and evidence aliases remain intact.
- [ ] Tool metadata decreases by the removed definitions and no new mega-schema replaces them.
- [ ] Historical references are clearly marked rather than silently masquerading as current guidance.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/index.test.ts \
  private/stardock/test/briefs.test.ts \
  private/stardock/test/worker-reports.test.ts \
  private/stardock/test/policy.test.ts \
  private/stardock/test/batch-mutations.test.ts \
  private/stardock/test/views.test.ts
cd ../.. && rg -n 'stardock_brief_worker|stardock_advisory_adapter|includeOverview|includeState|includePromptPreview' \
  agent/extensions/private/stardock/src \
  agent/extensions/private/stardock/README.md \
  agent/extensions/private/stardock/skills \
  agent/agents agent/skills .pi/plans
npm test --prefix agent/extensions
```

Expected signal: focused/full suites pass; final `rg` returns no production/current-guidance hits, and every historical-plan hit is beneath a clear superseded notice; tool-surface measurement reflects the deletion.

## Risks and split triggers

- Removing old tool schemas affects resumed prompts or external callers. Keep Slice 04 as the immediately preceding revert point.
- If compatibility must remain longer, finish all first-party migration and postpone this slice rather than adding hidden aliases to unrelated tools.
