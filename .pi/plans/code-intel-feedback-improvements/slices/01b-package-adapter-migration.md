# Slice 01b — Pi Adapter Migration to Standalone Package

## Purpose

Make the Pi extension consume `/home/fl/code/personal/code-intel/` as the reusable behavior source of truth. Remove the Pi extension's duplicated common source from normal ownership and keep only Pi-specific adapter/integration files locally.

## Prerequisite

Slice 01 decision is complete. Use `docs/package-integration-decision.md` as the architectural handoff.

## Chosen boundary

Use a local package/library dependency plus a curated standalone package integration facade:

- standalone package: add a `code-intel/pi-integration` export;
- Pi extension: add a local `file:../../../../../code-intel` dependency and import reusable specs/helpers from `code-intel/pi-integration`;
- reusable behavior remains in `/home/fl/code/personal/code-intel/`;
- Pi extension remains responsible for event hooks, renderers, touched-file defaults, footer/status, usage tracking, skills, and integration tests.

## Required standalone package changes

In `/home/fl/code/personal/code-intel/`:

1. Add `src/pi-integration.ts` as a curated facade.
   - Re-export `CodeIntelToolSpec`, `CodeIntelToolResult`, `JsonObjectSchema`, `listCodeIntelToolSpecs`, `codeIntelToolSpec`, and `runCodeIntelTool`.
   - Re-export `CodeIntelEnv`, `CodeIntelMutationPolicy`, `loadStandaloneConfig`, and `createCodeIntelEnv`.
   - Re-export stable types needed by Pi-only code: `CodeIntelConfig`, `LoadedConfig`, `BackendStatus`, `LanguageServerStatus`, and post-edit diagnostic types.
   - Re-export helper functions Pi needs: `ensureInsideRoot`, repo-root resolution, and `collectTouchedDiagnostics`.
   - Do not import Pi APIs from this facade.

2. Add the facade to package exports and build inputs.
   - Update `package.json` `exports` with `./pi-integration` pointing at `dist/pi-integration.js` and `dist/pi-integration.d.ts`.
   - Update `tsconfig.build.json` `files` so the facade emits into `dist`.

3. Add standalone tests for the export surface.
   - A package-export test should import `code-intel/pi-integration` through a temporary linked consumer or a direct package-like path and assert key exports exist.
   - Keep it lightweight; this is a contract test for the adapter boundary, not behavior coverage.

## Required Pi extension changes

In `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/` and the extension workspace:

1. Add the local dependency.
   - Add `"code-intel": "file:../../../../../code-intel"` to `private/code-intelligence/package.json` dependencies.
   - Remove direct runtime dependencies that are only needed by the mirrored reusable source if they are now provided by `code-intel`.
   - Update `agent/extensions/package-lock.json` from the workspace root.

2. Update Pi adapter imports.
   - `src/pi-tool-adapter.ts` should import `CodeIntelToolSpec`, `CodeIntelToolResult`, `CodeIntelEnv`, and config/env helpers from `code-intel/pi-integration`.
   - Build `CodeIntelEnv` using package config helpers, then set Pi-specific values: `cwd = ctx.cwd`, `mutationPolicy`, `pathBase = "repo"`, and `persistentLsp = true`.
   - Preserve Pi details/content shape exactly.

3. Update tool registration wrappers.
   - Replace imports of local mirrored specs with `codeIntelToolSpec(...)` or `listCodeIntelToolSpecs(...)` from `code-intel/pi-integration`.
   - Keep existing custom renderers and `afterResult` hooks.
   - Preserve public tool names and schemas.

4. Update Pi-specific hooks that used common helpers.
   - `slices/post-edit-map/touched-files.ts`: import `ensureInsideRoot` from the package facade or replace only trivial event-payload parsing with Pi-local helpers.
   - `slices/diagnostic-surface/hook.ts`: import diagnostic collection and repo-root helpers from the package facade.
   - `slices/state/tool.ts`: run the package `code_intel_state` spec for state details and footer status instead of importing mirrored `state/run.ts` helpers directly.

5. Remove or stop owning duplicated common source.
   - Delete or exclude the 97 mirrored common files under `private/code-intelligence/src` once imports no longer need them.
   - Keep these Pi-only source files:
     - `src/core/tool-render.ts`
     - `src/pi-tool-adapter.ts`
     - `src/slices/diagnostic-surface/hook.ts`
     - `src/slices/impact-map/tool.ts`
     - `src/slices/local-map/tool.ts`
     - `src/slices/orientation/tools.ts`
     - `src/slices/post-edit-map/touched-files.ts`
     - `src/slices/state/footer-status.ts`
     - `src/slices/state/tool.ts`
     - `src/slices/syntax-search/tool.ts`
     - `src/slices/targeted-symbols/tools.ts`
     - `src/slices/usage/followup.ts`
     - `src/slices/usage/usage.ts`
   - Remove `src/config.ts` if `pi-tool-adapter.ts` uses package env/config helpers instead.
   - Remove Pi extension `main`, `types`, `bin`, and standalone `build` metadata if the extension no longer builds or ships a standalone CLI.

6. Update tests.
   - Keep Pi-specific integration tests.
   - Remove or relocate tests that only duplicate standalone package behavior.
   - Add adapter-boundary tests for importing `code-intel/pi-integration` and registering specs through Pi wrappers.
   - Ensure touched-file default injection and idle diagnostic surfacing still have Pi tests.

7. Update docs and skills.
   - Pi extension README/skill should say reusable behavior is imported from `/home/fl/code/personal/code-intel/`.
   - Source-of-truth docs should remove temporary mirror language after migration lands.

## Acceptance criteria

- Pi extension imports reusable tool specs/helpers from `code-intel/pi-integration`.
- Common mirrored source is deleted or no longer compiled/owned by the Pi extension.
- Public Pi tool names, prompts, schemas, content text, and structured details remain compatible.
- Pi-specific touched-file defaults for `post_edit_map` still work.
- Idle diagnostic surfacing still collects touched-file diagnostics without treating them as baseline proof.
- Footer/status still refreshes on session start and after `code_intel_state`.
- Future feedback behavior fixes can be implemented in `/home/fl/code/personal/code-intel/` first without manual source copying.

## Validation

```bash
cd /home/fl/code/personal/code-intel && npm run typecheck
cd /home/fl/code/personal/code-intel && npm test
cd /home/fl/code/personal/code-intel && npm run build
cd /home/fl/code/personal/code-intel && npm run smoke:cli
cd /home/fl/code/personal/pi/agent/extensions && npm install --package-lock-only
cd /home/fl/code/personal/pi/agent/extensions && npm run typecheck
cd /home/fl/code/personal/pi/agent/extensions && npm test
cd /home/fl/code/personal/pi/agent/extensions && npm run eval:code-intel
```

If dependency installation changes runtime module layout, also run a focused Pi extension startup/import smoke test or use `/reload` in a real Pi session before claiming the live extension is ready.

## Handoff notes

Do not start Slice 02 feedback behavior changes until this adapter migration is implemented or the user explicitly accepts a temporary mirror bridge.
