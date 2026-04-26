# Pi Extension Workspace

This directory contains Pi extensions split by intended audience.

- [`public/`](./public) — best-effort packages intended to be usable by other Pi users without this repository's private local setup. They may integrate with ordinary domain tools when that is core to the extension, but they should degrade clearly when optional tools or credentials are missing.
- [`private/`](./private) — personal extensions for this Pi setup. These may encode preferred tooling, account-specific compatibility notes, or other assumptions that are useful here but not promised as public package behavior.

The root `package.json` is private and exists only as a local convenience bundle. It loads both public and private extensions for this agent installation. Public extensions are published **individually**; there is intentionally no public bundle package.

## Public extensions

| Package | Path | Summary |
| --- | --- | --- |
| `@badliveware/pi-compaction-continue` | [`public/compaction-continue`](./public/compaction-continue) | Sends `continue` after context-overflow/active-loop compactions leave Pi idle. |
| `@badliveware/pi-pr-upstream-status` | [`public/pr-upstream-status`](./public/pr-upstream-status) | Tracks upstream pull requests and emits PR primitives for status/footer composition. |
| `@badliveware/pi-footer-framework` | [`public/footer-framework`](./public/footer-framework) | Configurable footer framework that can own the footer and compose primitives. |
| `@badliveware/pi-model-catalog` | [`public/model-catalog`](./public/model-catalog) | Exposes Pi model listings and configurable model-selection guidance as an agent tool. |

Public packages should remain useful independently within reason:

- document required Pi APIs, credentials, and ordinary domain dependencies;
- treat external CLIs and credentials as optional unless the extension's domain inherently requires them;
- fail closed or degrade with clear status messages when optional capabilities are unavailable;
- avoid hard-coding local paths, personal accounts, private tools, or machine-specific assumptions;
- keep package metadata, install docs, and `npm pack --dry-run` output publishable.

## Private extensions

There are currently no private extension packages. Keep the directory for future local-only extensions.

Private packages can assume this user's local workflow and are not intended to be published as-is.

## Local auto-discovery

When this directory is symlinked or copied to `~/.pi/agent/extensions`, Pi reads the root package manifest and loads these entries:

```text
public/compaction-continue/index.ts
public/pr-upstream-status/index.ts
public/footer-framework/index.ts
public/model-catalog/index.ts
```

Run `/reload` after changing files.

## Install all locally

The root package is a private local bundle:

```bash
pi install /path/to/agent/extensions
```

## Publish public extensions individually

See [`PUBLISHING.md`](./PUBLISHING.md) for the full checklist.

Pushing to `main` does not publish anything. Publishing is manual via tag push, one extension at a time:

```bash
git tag pi-ext/model-catalog/v0.1.0
git push origin pi-ext/model-catalog/v0.1.0
```

Dry-run every public package locally:

```bash
cd agent/extensions
npm run pack:public
```

Dry-run one package locally:

```bash
cd agent/extensions
./scripts/pack-public.sh model-catalog
```

Do not publish packages from `private/` unless they have first been generalized and moved to `public/`.

## Install published packages

Install only what you need:

```bash
pi install npm:@badliveware/pi-compaction-continue
pi install npm:@badliveware/pi-pr-upstream-status
pi install npm:@badliveware/pi-footer-framework
pi install npm:@badliveware/pi-model-catalog
```
