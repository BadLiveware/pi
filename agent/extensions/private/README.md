# Private Pi Extensions

Extensions in this directory are for this user's local Pi workflow.

Private extensions may encode local preferences, installed-tool assumptions, account-specific compatibility notes, experimental APIs, or unpublished workflow behavior. They should still avoid secrets and accidental machine-specific paths unless those paths are intentionally documented as local-only.

Do not publish packages from this directory as-is. If a private extension becomes generally useful, first remove personal assumptions, document dependencies and fallback behavior, move it to `../public/`, add public README/changelog/package metadata, and update the public publish workflow and pack validation allowlists.

## Current private packages

| Package | Purpose |
| --- | --- |
| `code-intelligence` | Local Tree-sitter/LSP/rg routing tools for impact maps, syntax search, and scoped read-next maps. |
| `rich-output` | Prototype structured timeline output, including terminal-native blocks, diagrams, charts, and artifact-backed previews. |
| `stardock` | Private governed implementation framework for persistent multi-iteration work loops and verification ledgers. |

These packages are linked/used locally from this repository and are not part of the public npm release set.
