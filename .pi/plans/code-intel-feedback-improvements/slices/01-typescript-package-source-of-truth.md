# Slice 01 — TypeScript Package Source-of-truth Adoption

## Purpose

Remove the split source-of-truth problem before feedback-driven behavior fixes. The standalone TypeScript package at `/home/fl/code/personal/code-intel/` should be the reusable implementation source, and the Pi extension should consume it through a thin adapter instead of maintaining an independent vendored mirror of common source files.

## Current evidence

Slice 00 found:

- `/home/fl/code/personal/code-intel/` is the standalone TypeScript package named `code-intel`.
- The Pi extension at `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/` currently vendors/mirrors common TypeScript source files from that package.
- Common reusable files are byte-identical today, but keeping two copies creates sync risk.
- The Pi extension adds Pi-specific hooks, session tracking, footer/status behavior, usage feedback, touched-file tracking, skills, and tool registration wrappers.
- No Rust/native code-intel implementation is part of this plan.

## Slice result

Decision: use a local package/library dependency plus a curated `code-intel/pi-integration` facade. The decision record is `docs/package-integration-decision.md`; the follow-up implementation slice is `slices/01b-package-adapter-migration.md`.

Key proof point from execution: a temporary linked TypeScript consumer can import `listCodeIntelToolSpecs` and `CodeIntelToolSpec` from `code-intel`, but `CodeIntelEnv` is not exported from `code-intel/standalone`; the migration therefore needs an explicit integration facade rather than relying only on current exports.

## Architecture decision made

The options considered for how the Pi extension should consume `/home/fl/code/personal/code-intel/` were:

1. **Workspace/local package dependency** — Pi extension imports the standalone package through a local `file:`/workspace dependency and depends on its built `dist` exports.
2. **Source symlink or generated mirror** — Pi extension links common source from the standalone package while keeping Pi-only files local.
3. **CLI/MCP subprocess** — Pi extension shells out to the standalone `code-intel` CLI or talks to its MCP/server API.
4. **Status quo mirror** — keep manual mirroring only as a short-lived compatibility bridge with a recorded removal plan.

Chosen outcome: reusable behavior is edited once in `/home/fl/code/personal/code-intel/`; Pi owns only adapter/integration behavior. The local package/library dependency was chosen because it preserves in-process tool execution, custom Pi renderers/hooks, and public tool contracts while eliminating manual source copying.

## Required tasks

1. Inspect the current standalone export surface.
   - Read `package.json`, `src/tool-registry.ts`, `src/standalone/mcp.ts`, tool spec exports, and build outputs.
   - Confirm whether Pi can import `CodeIntelToolSpec` objects directly from the package.
   - Identify any missing exports needed by `src/pi-tool-adapter.ts` or Pi-specific wrappers.

2. Inspect the Pi extension dependency and build constraints.
   - Read `agent/extensions/package.json`, workspace/package-lock behavior, extension build/test commands, and runtime loading assumptions.
   - Decide whether a local `file:` dependency, workspace dependency, or built package import is viable inside Pi’s extension loader.

3. Choose the integration boundary.
   - Prefer a package/library import if it preserves Pi tool names and avoids subprocess overhead.
   - Document why rejected alternatives are worse for local development, runtime reliability, or compatibility.
   - Define how Pi-specific touched-file defaults for `post_edit_map` layer on top of reusable package behavior.

4. Create the adapter migration slice.
   - List files to delete from the Pi mirror or stop compiling as duplicated common source.
   - List Pi-only files that remain.
   - List package.json/tsconfig/package-lock changes.
   - Include validation commands for standalone package and Pi extension.

5. Update plan docs.
   - `docs/source-of-truth.md` must name `/home/fl/code/personal/code-intel/` as the reusable TypeScript source of truth and document the chosen integration boundary.
   - README execution spine must put adapter migration before feedback behavior fixes.
   - Feedback slices must target `/home/fl/code/personal/code-intel/` first and Pi adapter behavior only where needed.

## Acceptance criteria

- [x] The chosen Pi integration boundary is documented with rejected alternatives and validation proof points.
- [x] A concrete follow-up slice exists for adapter migration.
- [x] Feedback behavior fixes are planned against `/home/fl/code/personal/code-intel/` first.
- [x] The Pi extension mirror is treated as something to remove or replace, not the behavior source of truth.

## Validation

Baseline while deciding:

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
```

After the boundary decision, add focused validation for the selected dependency/import path before starting feedback behavior fixes.

Slice 01 execution added the focused validation target to `docs/validation.md` and `slices/01b-package-adapter-migration.md`.

Executed validation:

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
```

Result: all passed. Standalone package tests passed 10/10. A temporary linked-consumer TypeScript probe also verified root imports from `code-intel` work and `CodeIntelEnv` is not currently exported from `code-intel/standalone`.

## Exit criteria

A future agent can implement the adapter without guessing how Pi imports reusable code-intel behavior, which files remain Pi-only, or which repository owns feedback-driven behavior fixes.
