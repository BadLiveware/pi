# Code-intel Source-of-truth Map

## Summary

Reusable code-intel behavior is implemented in the standalone TypeScript package at `/home/fl/code/personal/code-intel/`. The Pi extension at `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/` currently carries a vendored/mirrored copy of the common TypeScript source plus Pi-only integration files.

Chosen architecture: Pi should consume `/home/fl/code/personal/code-intel/` through a local package/library dependency and a curated `code-intel/pi-integration` facade. See `docs/package-integration-decision.md`.

Source-of-truth rule:

1. Make reusable behavior plans and future fixes target `/home/fl/code/personal/code-intel/` first.
2. Do not treat the Pi extension mirror as the source of truth.
3. Make Pi-only integration changes only in the Pi extension.
4. After adapter migration, validate the standalone package and Pi adapter separately.

## Evidence inspected

- `/home/fl/code/personal/code-intel/package.json`
  - package name: `code-intel`
  - standalone CLI/MCP package with `bin.code-intel = ./dist/standalone/cli.js`
  - scripts include `typecheck`, `test`, `build`, `smoke:cli`, and `ci`.
  - exports package root and `./standalone` from built `dist` files.
- `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/package.json`
  - package name: `pi-private-code-intelligence`
  - Pi extension package with `pi.extensions = ["./index.ts"]`
  - includes the same standalone build target but also depends on Pi peer APIs.
- `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/index.ts`
  - registers Pi event hooks, resources, footer/status refresh, usage tracking, touched-file tracking, diagnostic surfacing, and Pi tool registrations.
- `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/src/pi-tool-adapter.ts`
  - adapts reusable `CodeIntelToolSpec` objects into Pi `registerTool` calls.
- `/home/fl/code/personal/pi/agent/extensions/private/code-intelligence/src/slices/targeted-symbols/tools.ts`
  - adds Pi session-tracked touched-file behavior before running the reusable `postEditMapToolSpec`.
- Tree comparison between the standalone and Pi extension source trees:
  - `src/`: 97 common files are byte-identical.
  - Pi extension has 14 additional source files for config, Pi adapters, tool registration wrappers, footer/status, diagnostic surfacing, usage follow-up, and touched-file tracking.
  - `test/`: 2 common files are byte-identical, `test-harness.ts` differs, and the Pi extension has 25 additional integration/coverage tests.
  - `docs/claude-code-mcp.md` exists in both but differs.
- Git history shows paired standalone and Pi sync commits, for example:
  - standalone: `feat: keep csharp-ls sessions warm`
  - Pi repo: `feat: sync warm csharp-ls sessions`

## Current relationship

The Pi extension does not currently import `/home/fl/code/personal/code-intel/` as an npm dependency or symlink during normal execution. Instead, it vendors a mirrored copy of the reusable source files and adds Pi-specific wrappers.

No Rust-native code-intel implementation is part of this plan. The implementation is TypeScript and uses `@vscode/tree-sitter-wasm` for parsing. Rust language support currently means parsing Rust source with `tree-sitter-rust.wasm` and optionally shelling out to `rust-analyzer` for exact references or diagnostics; it is not a Rust-native engine.

Common reusable files are currently identical between the TypeScript package and Pi extension mirror. That identifies the current split-source mechanism; Slice 01 chose to replace it with package consumption via a `code-intel/pi-integration` facade.

## File ownership guide after package adoption

- `/home/fl/code/personal/code-intel/` owns reusable tool behavior, schemas/contracts, compact output or structured details, algorithms, parser/provider integration, standalone CLI/MCP behavior, package exports, and standalone tests.
- The standalone package should expose Pi-needed reusable APIs through `code-intel/pi-integration` rather than requiring Pi to import deep internal paths.
- Pi extension owns Pi event hooks, session tracking, footer/status, skills, usage feedback, touched-file defaults, tool registration/adaptation, rich TUI renderers, runtime operation logs, and Pi integration tests.
- A thin adapter translates between Pi `registerTool` contracts and standalone package `CodeIntelToolSpec`-style exports.

Temporary Pi-only guide before package adoption:

Edit only in the Pi extension for:

- `index.ts`,
- `src/pi-tool-adapter.ts`,
- `src/config.ts`,
- `src/slices/*/tool.ts` and `tools.ts` registration wrappers,
- `src/slices/post-edit-map/touched-files.ts`,
- `src/slices/diagnostic-surface/hook.ts`,
- `src/slices/usage/**`,
- `src/slices/state/footer-status.ts` and Pi status/skill behavior,
- Pi-specific tests and skills.

## Sync/build implication

There is no automatic sync step discovered for the current TypeScript mirror. Slice 01 chose a package consumption path that eliminates routine source copying after Slice 01b. Until Slice 01b is implemented, reusable behavior fixes should start in `/home/fl/code/personal/code-intel/` and only touch the Pi mirror if the user accepts a temporary bridge or the adapter migration requires it.

## Validation commands

For reusable behavior changes in `/home/fl/code/personal/code-intel/`:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:cli
```

For Pi extension mirror or integration changes in `/home/fl/code/personal/pi/agent/extensions/`:

```bash
npm run typecheck
npm test
npm run eval:code-intel
```

Slice 01 selected focused validation for the package integration boundary: add `code-intel/pi-integration` export tests in the standalone package and Pi adapter tests that import that facade from the extension workspace.

## Noted cleanup item

`/home/fl/code/personal/pi/agent/extensions/package-lock.json` still records `private/code-intelligence` bin metadata as `src/standalone/cli.ts`, while the Pi extension package manifest now declares `./dist/standalone/cli.js`. This was recorded as a packaging/docs cleanup candidate, not as a blocker for feedback-driven tool behavior work.
