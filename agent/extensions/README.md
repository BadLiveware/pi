# Pi Extension Workspace

This directory contains separate Pi extensions that can be used locally together or published independently.

## Extensions

- [`plan-mode`](./plan-mode) — read-only planning mode with todo extraction and tool restoration.
- [`compaction-continue`](./compaction-continue) — sends a plain `continue` after context-overflow/active-loop compactions leave Pi idle.
- [`pr-upstream-status`](./pr-upstream-status) — tracks upstream pull requests and emits PR primitives for status/footer composition.
- [`footer-framework`](./footer-framework) — configurable footer framework that can own the footer and compose primitives.

## Local auto-discovery

When this directory is symlinked or copied to `~/.pi/agent/extensions`, Pi auto-discovers each subdirectory containing `index.ts`:

```text
plan-mode/index.ts
compaction-continue/index.ts
pr-upstream-status/index.ts
footer-framework/index.ts
```

Run `/reload` after changing files.

## Install all as one local package

The root `package.json` is private and exists only as a local convenience bundle:

```bash
pi install /path/to/agent/extensions
```

## Publish independently

Each extension directory is its own package root:

```bash
cd plan-mode
npm pack --dry-run
npm publish

cd ../compaction-continue
npm pack --dry-run
npm publish

cd ../pr-upstream-status
npm pack --dry-run
npm publish

cd ../footer-framework
npm pack --dry-run
npm publish
```

After publishing, install them independently:

```bash
pi install npm:pi-plan-mode
pi install npm:pi-compaction-continue
pi install npm:pi-pr-upstream-status
pi install npm:pi-footer-framework
```

Before publishing, update each package name/scope, license, repository, and version as needed.
