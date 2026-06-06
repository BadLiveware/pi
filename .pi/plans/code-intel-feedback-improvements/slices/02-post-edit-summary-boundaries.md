# Slice 02 — Post-edit Summary and Project-boundary Regression

## Purpose

Make `code_intel_post_edit_map` immediately actionable for the strongest feedback-backed cases: noisy compact summaries and broad C# project-boundary edits that currently produce low-signal empty-symbol output.

## Feedback covered

- CI-FB-001: compact output emphasizes low-level changed fields before actionable next steps.
- CI-FB-002: broad C# project-boundary extraction returned `changed=0 related=0 tests=31` despite meaningful `.cs` and `.csproj` changes.

## Source-of-truth

Use `docs/source-of-truth.md`.

Primary reusable edits should target `/home/fl/code/personal/code-intel/`, the source of truth selected by Slice 01. Mirror common files into the Pi extension only if Slice 01 explicitly chooses a temporary mirror bridge. Pi-only edits are needed only if session-tracked touched files or tool registration behavior changes.

## Implementation tasks

1. Add post-edit compact-output regression coverage in the standalone package.
   - Target: `/home/fl/code/personal/code-intel/test/standalone.test.ts` or a new focused compact-output test if that package has suitable harness support.
   - Fixture: changed symbols, related rows, test candidates, and diagnostics in one `post_edit_map` result.
   - Expected: compact output starts with next-action lines and summary/limitations before detailed changed declaration rows.

2. Add C# project-boundary regression coverage in the standalone package.
   - Fixture: one `.csproj`, at least two `.cs` files, and one test-like file.
   - Invoke `code_intel_post_edit_map` with changed `.cs` and `.csproj` files.
   - Expected: changed project/build boundary files are represented in structured details or summary; empty-symbol causes are explained; bounded source/test validation hints are visible.

3. Implement compact output ordering.
   - Likely module: `src/slices/post-edit-map/compact.ts`.
   - First lines should answer what to inspect or validate next.
   - Changed declaration details should remain capped and available after the actionable summary.

4. Implement project-boundary/non-symbol changed-file classification if tests require it.
   - Likely module: `src/slices/targeted-symbols/run.ts` post-edit flow.
   - Classify project/build/config files separately from parser-supported declaration source files.
   - Preserve changed files with no extracted symbols as validation context rather than letting them disappear behind `changed=0`.

5. Update the Pi adapter for the selected package boundary.
   - Do not copy reusable behavior into the Pi extension unless Slice 01 explicitly chose a temporary mirror bridge.
   - Keep Pi-only integration limited to adapter/session-tracking/tool-registration support.

6. Update docs only for implemented behavior.
   - Standalone README if CLI/MCP-visible behavior changes.
   - Pi extension README/skill only if Pi agents need new interpretation guidance.

## Acceptance criteria

- Feedback-backed tests for compact summary and C# project-boundary edits pass in the standalone package.
- Pi adapter tests pass for the same behavior or broader integration behavior.
- Compact `post_edit_map` output no longer presents a bare low-signal empty result as the main outcome when meaningful changed files exist.
- Existing `post_edit_map` details remain backward-compatible for current consumers.

## Validation

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/code-intel && npm run build && npm run smoke:cli
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
cd /home/fl/code/personal/pi/agent/extensions && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run eval:code-intel
```

## Handoff notes

If this slice reveals that project-boundary classification needs a larger cross-language design, keep the compact-summary fix and C# regression fixture, then record the broader boundary design as a follow-up before changing route or diagnostics slices.
