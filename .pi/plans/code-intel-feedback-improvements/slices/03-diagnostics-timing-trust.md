# Slice 03 — Diagnostics Trust and Slow/Partial Post-edit Clarity

## Purpose

Improve trust in `post_edit_map` diagnostics and make slow or partial post-edit runs explain themselves without hiding useful completed work.

## Feedback covered

- CI-FB-003: TypeScript diagnostics sometimes appeared noisy or false-positive relative to project-native validation.
- CI-FB-004: a scoped post-edit map took about 47 seconds and produced a terse visible summary that did not affect validation decisions.

## Prerequisite

Complete Slice 01 TypeScript package source-of-truth adoption and Slice 02's compact-output changes, or explicitly confirm that Slice 02's compact-output changes are not needed for this slice. This slice should build on the post-edit summary structure rather than invent a separate rendering path.

## Source-of-truth

Use `docs/source-of-truth.md`.

Reusable diagnostics and post-edit behavior belongs in `/home/fl/code/personal/code-intel/`, the source of truth selected by Slice 01. Pi diagnostic surfacing hooks belong in the Pi extension only when idle surfaced diagnostics need integration-specific wording or throttling changes.

## Implementation tasks

1. Add diagnostic provenance/freshness tests.
   - Include supplied diagnostics and collected fake-provider diagnostics.
   - Assert rows preserve provider/source, collection provenance, and freshness confidence.
   - Use `unknown` freshness when the provider cannot cheaply prove current file-content alignment.

2. Add post-edit timing/partial-result tests.
   - Avoid wall-clock sleeps.
   - Prefer deterministic phase metadata or controlled fake failures if the current code can be structured for it.
   - Assert completed phase results survive when diagnostics or another phase fails or is aborted.

3. Extend normalized diagnostic rows.
   - Likely module: `src/slices/post-edit-map/diagnostics.ts`.
   - Add provenance fields that are cheap and stable enough for both standalone and Pi use.
   - Do not present diagnostics as baseline-compared proof.

4. Add post-edit phase timing metadata.
   - Likely module: `src/slices/targeted-symbols/run.ts`.
   - Track discovery, symbol extraction, impact map, test map, diagnostics collection, and diagnostic target resolution.
   - Render timing in compact output only when it explains a slow or partial result.

5. Update the Pi adapter or diagnostic surface only if the selected package boundary requires integration changes.

6. Update README guidance.
   - Explain diagnostic provenance/freshness confidence.
   - Explain that partial results preserve completed routing/test/diagnostic phases and name failed or slow phases.

## Acceptance criteria

- Agents can distinguish supplied diagnostics, collected diagnostics, and diagnostics with unknown freshness.
- Slow or partial post-edit results name the expensive or failed phase without cluttering normal fast output.
- Completed changed-symbol, related, test, or diagnostic rows are not discarded because one later phase fails.
- Existing diagnostic provider tests still pass after updated expected fields.

## Validation

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
cd /home/fl/code/personal/pi/agent/extensions && npm test
```

Run `npm run eval:code-intel` in the Pi extension if compact output or agent guidance changes.
