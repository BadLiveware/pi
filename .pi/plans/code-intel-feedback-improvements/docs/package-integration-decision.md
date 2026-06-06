# Code-intel Package Integration Decision

## Decision

Use a local package/library boundary: the Pi extension should depend on the standalone TypeScript package at `/home/fl/code/personal/code-intel/` and import a curated integration facade from that package. Do not keep the Pi extension's vendored common source as the reusable behavior implementation.

The migration should add a stable package subpath such as `code-intel/pi-integration` that exports the reusable tool specs plus the small helper surface Pi needs for environment construction, diagnostics surfacing, repo path safety, and types.

## Context and constraints

- Pi extensions are TypeScript modules loaded by Pi and can import npm dependencies from a package-local or parent `node_modules`.
- `/home/fl/code/personal/code-intel/` already publishes built package exports for the root tool registry and `./standalone` MCP entry.
- The Pi extension currently uses Pi-specific files for event hooks, session state, footer status, usage tracking, touched-file tracking, rich TUI renderers, skills, and `registerTool` adaptation.
- Common source files in the Pi extension are byte-identical mirrors of the standalone package today, but manual sync commits show the mirror is a real maintenance burden.
- Public Pi tool names and schemas should remain stable.
- Feedback behavior fixes should land once in the standalone package and be consumed by Pi through the adapter.

## Current export findings

Standalone package currently exports:

- package root (`code-intel`) from `dist/tool-registry.js`, including `CodeIntelToolSpec`, `CodeIntelToolResult`, `listCodeIntelToolSpecs`, `codeIntelToolSpec`, and `runCodeIntelTool`;
- `code-intel/standalone` from `dist/standalone/mcp.js`, including MCP server helpers.

Focused type check evidence from a temporary consumer:

- `import { listCodeIntelToolSpecs, type CodeIntelToolSpec } from "code-intel"` type-checks when `code-intel` is linked into `node_modules`.
- `import type { CodeIntelEnv } from "code-intel/standalone"` does **not** type-check because `CodeIntelEnv` is imported locally by `standalone/mcp.ts` but not re-exported.

Missing or inconvenient exports for Pi migration:

- `CodeIntelEnv`, `CodeIntelMutationPolicy`, and environment/config helpers such as `loadStandaloneConfig` or `createCodeIntelEnv`;
- repo safety helpers used by Pi session tracking, such as `ensureInsideRoot` and repo-root resolution;
- touched-file diagnostic collection APIs and diagnostic row types used by Pi's idle diagnostic surface;
- a curated, stable place to import these from without depending on many deep internal package paths.

## Chosen shape

1. Add a `code-intel/pi-integration` package export in `/home/fl/code/personal/code-intel/`.
2. Implement it as a small facade over existing standalone modules, not a Pi dependency inside the standalone package.
3. Add it to the standalone build inputs so `dist/pi-integration.js` and declarations are emitted.
4. Add `"code-intel": "file:../../../../../code-intel"` to the Pi extension package dependencies, with package-lock updated from the extension workspace root.
5. Update Pi-only adapter/wrapper files to import reusable behavior from `code-intel/pi-integration` instead of `./src` mirrored common modules.
6. Remove or stop compiling the Pi extension's duplicated common source after the adapter imports are migrated.

## Pi-specific layering

The Pi extension should keep owning:

- `index.ts` event wiring;
- `src/pi-tool-adapter.ts` and any Pi `registerTool` render/afterResult hooks;
- session-touched-file tracking and default `post_edit_map` changed-file injection;
- idle diagnostic surfacing messages and trigger behavior;
- footer/status rendering and runtime operation logs;
- usage feedback/session-entry tracking;
- skills and Pi integration tests.

`post_edit_map` layering should remain:

1. reusable package owns `postEditMapToolSpec` and `runPostEditMap` behavior;
2. Pi adapter's `prepareParams` injects recent session-touched files when callers omit both `changedFiles` and `baseRef`;
3. Pi adapter's `afterResult` annotates `details.touchedFileSource = "session-tracker"` when tracked files were injected.

## Options considered

### Workspace/local package dependency — chosen

Pros:

- removes the behavior mirror;
- preserves direct in-process tool execution and custom Pi rendering hooks;
- keeps public Pi tool names and schemas stable;
- validates the same package surface standalone/MCP consumers use;
- makes future feedback fixes land once in `/home/fl/code/personal/code-intel/`.

Cons/risks:

- Pi tests/runtime need the standalone package built or installed through the workspace;
- package exports must be expanded carefully to avoid exposing unstable internals broadly;
- local development needs a clear `build standalone -> test Pi adapter` workflow.

### Source symlink or generated mirror — rejected

Pros:

- could preserve source-level hot editing and avoid dist-build dependency.

Cons:

- still makes the Pi extension compile/package source it does not own;
- symlink behavior in package installs and publish/pack flows is brittle;
- generated mirrors can drift unless enforced by tooling, recreating the same source-of-truth problem.

### CLI/MCP subprocess — rejected for this migration

Pros:

- would use the standalone CLI/MCP surface without adding package facade exports.

Cons:

- adds process startup/IPC overhead for every Pi tool call;
- makes cancellation, persistent LSP sessions, structured details, and custom render/afterResult hooks harder;
- duplicates Pi tool registration schemas around an external process boundary;
- worse fit for existing in-process `CodeIntelToolSpec` design.

### Status quo manual mirror — rejected except as short temporary bridge

Pros:

- no immediate code changes.

Cons:

- preserves split source-of-truth and paired sync commits;
- feedback fixes can still land in one copy and not the other;
- does not solve the problem this slice is meant to remove.

## Validation proof points

Adapter migration should verify:

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/code-intel && npm run build
cd /home/fl/code/personal/pi/agent/extensions && npm install --package-lock-only
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
cd /home/fl/code/personal/pi/agent/extensions && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run eval:code-intel
```

Add a focused Pi adapter test that imports `code-intel/pi-integration`, registers at least one read-only spec through `registerCodeIntelSpecTool`, and verifies public tool registration shape remains unchanged.

## Rollback

If the package dependency path fails during migration, keep the current Pi mirror temporarily but do not proceed with feedback behavior fixes. Record the failing import/install evidence and either adjust the package export facade or choose a narrowly scoped source-link bridge with a removal deadline.
