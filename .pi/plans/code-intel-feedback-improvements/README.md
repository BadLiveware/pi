# Code-intel Feedback Improvements

## Purpose

Improve code-intel from recent dogfood feedback, but first remove the source-of-truth split. The Pi extension should consume the standalone TypeScript package at `/home/fl/code/personal/code-intel/` as the reusable implementation source instead of maintaining an independent mirrored implementation.

## Desired end state

- `/home/fl/code/personal/code-intel/` is the reusable behavior source of truth.
- The Pi extension is a thin adapter: Pi event hooks, session tracking, footer/status, skills, usage feedback, touched-file defaults, and tool registration stay Pi-specific, while reusable tool behavior comes from the standalone package.
- Feedback-driven fixes target the standalone package first, then Pi adapter behavior only where needed.
- `code_intel_post_edit_map` gives useful, actionable output even when changed files include project/build/config boundaries or files with no extracted declaration symbols.
- Compact output prioritizes next reads, diagnostics, tests, limitations, and rerun hints before low-level symbol detail.
- Broad route workflows reduce noise with better ranking, grouping, and narrowing guidance.
- Slow or partial post-edit runs explain what completed, what was capped, and what evidence remains useful.
- Diagnostics carry enough provenance and freshness confidence that agents know whether to act immediately or run project-native validation.

## Scope

In scope:

- Source-of-truth migration from Pi-extension vendored mirror to consumption of `/home/fl/code/personal/code-intel/`.
- Architecture decision for the Pi/package integration boundary.
- Feedback-backed issue taxonomy and matrix.
- Regression fixtures and compact-output tests selected by the taxonomy.
- Post-edit map behavior for empty-symbol, project-boundary, non-symbol, and diagnostic cases.
- Route ranking and broad-query guidance.
- Timing, partial-result, and diagnostic freshness improvements selected by Slice 00.
- README/skill/tool guidance updates when behavior changes.

Out of scope unless reprioritized:

- A Rust/native code-intel rewrite or wrapper.
- A whole-program semantic index beyond what the standalone package already owns.
- Making optional LSP providers mandatory.
- Replacing project-native build, typecheck, lint, test, or benchmark validation.
- Changing public Pi tool names.
- Raising broad-scan caps as the primary answer to noisy or truncated output.
- Deep C++ parser/provider repair beyond actionable fallback guidance.

## Slice 00 outputs

Slice 00 produced:

- [`docs/source-of-truth.md`](docs/source-of-truth.md) — current standalone/Pi extension relationship and validation ownership.
- [`docs/feedback-matrix.md`](docs/feedback-matrix.md) — selected feedback records, issue classes, priorities, and promoted slices.
- [`docs/candidate-backlog.md`](docs/candidate-backlog.md) — deferred candidates not in the current execution spine.

Important update after follow-up clarification: `/home/fl/code/personal/code-intel/` is the intended TypeScript source of truth. Slice 01 chose package consumption, not Rust/native adoption; the next executable slice is adapter migration.

## Execution spine

1. [`slices/00-feedback-taxonomy.md`](slices/00-feedback-taxonomy.md) — completed by creating the source map, feedback matrix, and selected downstream slices.
2. [`slices/01-typescript-package-source-of-truth.md`](slices/01-typescript-package-source-of-truth.md) — completed by choosing the package/library boundary and creating the adapter migration slice.
3. [`slices/01b-package-adapter-migration.md`](slices/01b-package-adapter-migration.md) — migrate Pi from vendored mirror to the standalone package facade.
4. [`slices/02-post-edit-summary-boundaries.md`](slices/02-post-edit-summary-boundaries.md) — improve `post_edit_map` compact actionability and C# project-boundary handling against the standalone source of truth.
5. [`slices/03-diagnostics-timing-trust.md`](slices/03-diagnostics-timing-trust.md) — diagnostic provenance/freshness and slow/partial post-edit clarity.
6. [`slices/04-route-ranking-scope-control.md`](slices/04-route-ranking-scope-control.md) — broad route ranking, grouping, and narrowing guidance.

Shared validation guidance lives in [`docs/validation.md`](docs/validation.md). The Slice 01 decision record is [`docs/package-integration-decision.md`](docs/package-integration-decision.md). The optional Stardock wrapper is [`stardock-checklist.md`](stardock-checklist.md).

## Dependency graph

```text
00 feedback taxonomy + current source map
  └─> 01 TypeScript package source-of-truth adoption
        └─> 01b package adapter migration
              ├─> 02 post-edit summary + project boundaries
              ├─> 03 diagnostics timing/trust
              └─> 04 route ranking/scope control
```

Feedback behavior fixes should not proceed in the Pi extension mirror unless the user explicitly chooses a temporary bridge path.

## Source-of-truth rule

Use [`docs/source-of-truth.md`](docs/source-of-truth.md). Current facts:

- `/home/fl/code/personal/code-intel/` is the standalone TypeScript package and intended reusable source of truth.
- The Pi extension currently vendors a byte-identical mirror of common TypeScript files plus Pi-specific wrappers and tests.
- No Rust/native code-intel source is part of this plan.

Chosen rule after Slice 01:

- reusable behavior changes start in `/home/fl/code/personal/code-intel/`;
- Pi invokes/imports the standalone package through a local package dependency and `code-intel/pi-integration` facade;
- Pi-specific event hooks, session tracking, footer/status, skills, usage feedback, and tool-registration wrappers stay in the Pi extension;
- validate standalone package behavior and Pi adapter behavior separately.

## Cross-cutting constraints

- Preserve Pi tool names and agent-facing contracts unless an explicit migration decision says otherwise.
- Preserve vertical-slice organization: behavior, compact rendering, structured details, tests, and docs should land together for each selected improvement.
- Mapping tools provide navigation evidence, not completion proof.
- Keep scans bounded and report caps/truncation rather than silently expanding them.
- Preserve standalone CLI/MCP compatibility.
- Use `unknown` for diagnostic freshness when the provider cannot cheaply prove freshness.
- Avoid duplicating detailed implementation tasks across files; slice files are the execution source of truth.

## Final acceptance criteria

- Pi extension consumes `/home/fl/code/personal/code-intel/` or a documented package wrapper as reusable source of truth.
- Selected feedback-backed fixtures pass in the standalone package and Pi adapter where applicable.
- Existing Pi-extension code-intel validations pass for changed adapter areas.
- `post_edit_map` compact output is actionable for normal, empty-symbol, diagnostic, and partial-result cases.
- C# project-boundary edits no longer produce misleading low-signal empty summaries.
- Broad route queries include ranking improvements and clear narrowing guidance.
- Diagnostics display provenance and freshness confidence without overstating proof.
- Documentation reflects actual behavior and evidence boundaries.
