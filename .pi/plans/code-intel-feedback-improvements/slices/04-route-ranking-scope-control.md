# Slice 04 — Route Ranking and Broad-query Scope Control

## Purpose

Reduce noisy broad-route results while preserving the discovery value of `code_intel_repo_route`, `code_intel_local_map`, and impact/local ranking for unfamiliar repositories.

## Feedback covered

- CI-FB-007: broad route query was initially too broad/noisy until split.
- CI-FB-008: same-name helpers and generic terms diluted impact/local ranking in focused audits.

## Prerequisite

Complete Slice 01 TypeScript package source-of-truth adoption and decide whether Slices 02–03 changed shared compact-output conventions that route output should reuse.

## Source-of-truth

Use `docs/source-of-truth.md`.

Reusable ranking, grouping, and compact route behavior belongs in `/home/fl/code/personal/code-intel/`, the source of truth selected by Slice 01. Pi changes should be adapter/docs only unless Slice 01 explicitly chooses a temporary mirror bridge.

## Implementation tasks

1. Add broad-route ranking tests.
   - Fixture: repeated broad term across docs, source, and tests.
   - Expected: exact source/API/path evidence outranks generic literal matches.
   - Expected: compact output includes narrowing guidance when query breadth/truncation crosses the chosen threshold.

2. Add same-name helper/noise tests if the feedback matrix still supports this after Slice 01.
   - Fixture: common helper names such as `New`, `Run`, `load`, or a repeated domain term.
   - Expected: repeated low-value call rows are grouped or demoted; stronger file/path/symbol evidence remains visible.

3. Refine route scoring.
   - Likely module: `src/slices/repo-route/run.ts`.
   - Separate scoring components for exact symbol/basename/path evidence, declaration-like evidence, source literal evidence, test/doc evidence, and repeated generic term penalties.

4. Refine compact route output.
   - Likely module: `src/slices/repo-route/compact.ts`.
   - Group evidence by file with strongest reason first.
   - Add concise advice to narrow by `paths`, exact terms, or `local_map` when anchors are known.

5. Update the Pi adapter/docs if route guidance or the selected package boundary requires Pi integration changes.

## Acceptance criteria

- Broad route fixture is less noisy and includes actionable narrowing guidance.
- Narrow exact route queries keep existing usefulness and do not require extra parameters.
- Ranking tests assert durable ordering principles rather than brittle full row order.
- Existing orientation and eval tests pass.

## Validation

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
cd /home/fl/code/personal/pi/agent/extensions && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run eval:code-intel
```

## Deferred edge

Do not fold C++ parser failures into this slice unless the selected route fixture directly requires fallback messaging. Mixed-language and parser-error fallback remains deferred unless reprioritized.
