---
name: footer-framework-config
description: Use when the user wants to configure, tune, or troubleshoot the footer-framework extension layout/spacing/sections.
---

# Footer Framework Config

Use this skill when a user wants footer layout changes without editing extension source.

## Reach for This Skill When
- the user asks to reduce footer clutter, spacing, or jitter
- the user wants specific footer sections on/off
- the user wants model/branch/PR placement tuned
- the user wants the agent to decide a footer layout
- the user wants normal TypeScript formatting logic for a footer item without writing a full Pi extension
- the user wants to show data from an extension that does not emit footer-framework items
- the user wants default Pi footer restored quickly

## Commands Reference
- `/footerfx` — show current config
- `/footerfx on` — enable footer framework
- `/footerfx off` — restore default footer
- `/footerfx reset` — reset to defaults and persist to user config
- `/footerfx config` — show loaded source and config paths
- `/footerfx load` — reload user/project config files
- `/footerfx save user` — save current settings as user default
- `/footerfx save project` — save current settings for the current project
- `/footerfx section <cwd|stats|context|model|branch|pr|ext> <on|off>`
- `/footerfx item <id> <show|hide|reset>`
- `/footerfx item <id> line <n>`
- `/footerfx item <id> row <n>`
- `/footerfx item <id> zone <left|right>`
- `/footerfx item <id> order <n>`
- `/footerfx item <id> before <other-id>` / `/footerfx item <id> after <other-id>`
- `/footerfx item <id> column <n|center|middle|percent|off>`
- `/footerfx anchor <line|all> <gap|left|center|right|spread>`
- `/footerfx adapter` — list configured adapters
- `/footerfx adapter <id> pi <source-key> [label]`
- `/footerfx adapter <id> status <status-key> [label]`
- `/footerfx adapter <id> custom <custom-type> <path> [label]`
- `/footerfx adapter <id> template <template>`
- `/footerfx adapter <id> empty-template <template>`
- `/footerfx adapter <id> style <style>`
- `/footerfx adapter <id> remove`
- `/footerfx gap <min> <max>`

## Layout Principles
- The framework owns layout and formatting.
- Compatible extensions should emit structured data/status plus optional hints; hints are advisory only.
- Built-in footer items are default adapters unless replaced by `items.<id>.render` in TS/JS config.
- Existing extensions can be adapted from Pi status entries or custom session entries without changing their source.
- Built-in Pi/session data can be adapted from `pi` sources such as `cwd`, `model`, `stats`, `context`, `branch`, `pr`, and `extensionStatuses`.
- Adapter templates use a restricted Liquid-style grammar: quoted strings are literals (`{{ "EUR" }}`), unquoted terms are variables (`{{ pi.stats.costText }}`), and filters transform/style values (`{{ value | style: "accent,bold" }}`, `{{ pi.cwd | compactPath: 48, 2 }}`, `{{ pi.branch.label | truncate: 22 }}`).
- TS/JS configs can define normal synchronous render closures on `items.<id>.render` or `adapters.<id>.render`; use this when the user wants local helper functions, normal string methods, or logic that would make a template hard to read. Render closures return strings, spans, arrays, `null`, or `undefined`; `span(text, style, { url })` preserves token-level styling for debug output.
- Style tokens are Pi theme foreground colors/background colors and text attributes: e.g. `accent`, `muted`, `dim`, `success`, `warning`, `error`, `bg:toolSuccessBg`, `bold`, `underline`, `strikethrough`.
- User/project config and explicit agent changes override built-in adapter defaults, extension hints, and adapter defaults.
- The default layout uses two lines, but items can be placed on any positive footer line.
- Do not invent arbitrary hard limits for layout line numbers or columns; terminal width is the real rendering constraint. Prefer responsive columns like `center`, `50%`, or `66%` over absolute numeric columns when the user wants resize-stable middle placement.

## Workflow
1. Read current state with `/footerfx` or `footer_framework_state`.
2. When adapting built-in or extension data, call `footer_framework_sources` first. Prefer `piSources` for Pi data, existing `extensionStatuses` for extension status text, and recent `customEntries` when status text is insufficient. Do not request tool/command/skill metadata unless troubleshooting discovery itself; use `includeTools`, `includeCommands`, `includeSkills`, or `includeDetails` only when that extra runtime metadata is directly useful.
3. Add adapters with `footer_framework_adapter_config` for precise JSON config, or `/footerfx adapter ...` for simple status/custom-entry mappings.
4. Use templates when the user wants portable JSON config or simple token-level styling, such as `{{ pi.cwd | compactPath: 48, 2 | style: "dim" }} {{ pi.branch.label | default: "" | truncate: 22 | style: "accent" }}`.
5. Use `~/.pi/agent/footer-framework.config.ts` or `<project>/.pi/footer-framework.config.ts` when normal TS helper functions are clearer; commands and tools should keep writing JSON overrides rather than rewriting TS source unless the user explicitly asks.
6. Check `footer_framework_state` or `/footerfx-debug` for template/render diagnostics after changing templates or TS render closures.
7. Apply one focused change at a time (adapter, template/render closure, item placement, section, anchor, or gap).
8. Changes made through commands/tools persist automatically to the user JSON config; use `/footerfx save project` only when the user explicitly wants project-specific layout.
9. Prefer minimal-density defaults:
   - keep `cwd`, `stats`, `context`, `model`, `branch` on
   - show `pr` when relevant
   - adapt only the extension statuses the user wants instead of relying on the generic `ext` bucket
10. If the user dislikes custom-footer behavior, run `/footerfx off`.

## Presets
### Compact
- `/footerfx anchor all left`
- `/footerfx gap 1 8`
- `/footerfx section ext off`

### Balanced
- `/footerfx anchor all right`
- `/footerfx item model line 1`
- `/footerfx item model zone right`
- `/footerfx item model before branch`
- `/footerfx item ext line 2`
- `/footerfx item ext zone right`
- `/footerfx gap 2 16`
- `/footerfx section ext on`

### Expanded PR focus
- `/footerfx item pr line 3`
- `/footerfx item pr zone left`
- `/footerfx anchor 3 left`

### Default Pi feel
- `/footerfx off`
