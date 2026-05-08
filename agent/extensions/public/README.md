# Public Pi Extensions

Extensions in this directory are intended for best-effort public use while remaining useful in this local Pi setup.

Each subdirectory is published as an independent npm package. There is intentionally no public bundle package.

## Compatibility expectations

Public extensions should:

- run from a normal Pi installation with only their package files and documented dependencies;
- avoid local absolute paths, private account names, private commands, and machine-specific assumptions;
- make credentials optional where possible and document environment variables when needed;
- treat external CLIs as optional unless the extension's purpose inherently depends on that domain tool;
- provide clear fallback behavior or status messages when an optional capability is unavailable;
- keep package metadata suitable for independent `npm pack --dry-run` and eventual publish.

## Packages

| Package | Path |
| --- | --- |
| `@badliveware/pi-compaction-continue` | [`compaction-continue`](./compaction-continue) |
| `@badliveware/pi-pr-upstream-status` | [`pr-upstream-status`](./pr-upstream-status) |
| `@badliveware/pi-footer-framework` | [`footer-framework`](./footer-framework) |
| `@badliveware/pi-model-catalog` | [`model-catalog`](./model-catalog) |
| `@badliveware/pi-tool-feedback` | [`tool-feedback`](./tool-feedback) |
| `@badliveware/pi-rich-output` | [`rich-output`](./rich-output) |
| `pi-multi-harness-compat` | [`multi-harness-compatibility`](./multi-harness-compatibility) |
