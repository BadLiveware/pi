# Slice 00 — Feedback Taxonomy and Source-of-truth Mapping

## Purpose

Turn recent code-intel dogfood feedback into an executable improvement matrix before selecting implementation work. This slice is the gate for all later slices.

## Scope

This slice does not change tool behavior. It verifies where implementation should happen and records a feedback-backed issue matrix that later slices must use.

## Repositories and areas to inspect

Primary standalone package:

- `/home/fl/code/personal/code-intel/`
  - reusable code-intel engine, CLI, MCP server, source modules, and package tests.
  - expected validation: `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:cli`, and possibly `npm run ci`.

Pi extension integration:

- `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/`
  - Pi extension wrapper, Pi-specific hooks, skills, status/usage/touched-file integration, and any currently mirrored implementation files.
  - expected validation: `cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck && npm test && npm run eval:code-intel`.

Feedback sources:

- `~/.cache/pi-tool-feedback/*.jsonl`
- Full session records under `~/.pi/agent/sessions/` when compact logs omit note text.

## Required tasks

1. Verify source-of-truth relationship
   - Inspect `package.json`, imports, symlinks, or copy/sync mechanisms between `/home/fl/code/personal/code-intel` and the Pi extension.
   - Record whether behavior changes should be implemented first in the standalone package, the Pi extension, or both.
   - Record any required sync/build/link step after standalone changes so the Pi extension uses the updated code.

2. Build the feedback matrix
   - For each selected feedback record, capture:
     - timestamp or note hash,
     - repo where the tool was used,
     - watched tool names,
     - perceived usefulness and key field responses,
     - concise issue summary,
     - suspected affected module,
     - candidate regression fixture,
     - priority.
   - Keep note text compact and avoid dumping full session content.

3. Classify issue types
   - Empty or low-signal result.
   - Noisy or too-broad result.
   - Slow result.
   - Truncation reduced utility.
   - Diagnostic trust or freshness ambiguity.
   - Unsupported or mixed-language fallback gap.
   - Documentation or prompt-guidance gap.

4. Choose first implementation slice
   - Select one bounded first implementation slice from the matrix.
   - Recommended default if the evidence still supports it: `post_edit_map` compact summary plus empty-symbol/project-boundary fixture setup.
   - Update `README.md` execution order and downstream slice files so they reflect the selected evidence, not the initial brainstorm.

## Acceptance criteria

- `docs/feedback-matrix.md` exists and names the selected issues, affected repos, and candidate tests.
- `docs/source-of-truth.md` exists and explains how `/home/fl/code/personal/code-intel` relates to the Pi extension.
- Later slice files are updated or pruned based on the matrix.
- No behavior code is changed in this slice.

## Validation

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
```

If any validation command fails before implementation work, record it in `docs/feedback-matrix.md` as baseline status rather than fixing it in this slice.

## Exit criteria

A future agent can read `docs/source-of-truth.md` and `docs/feedback-matrix.md`, then know exactly which repository to edit first and which feedback-backed regression to implement next.
