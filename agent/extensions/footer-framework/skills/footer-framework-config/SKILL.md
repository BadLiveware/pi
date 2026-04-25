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
- `/footerfx section <cwd|stats|model|branch|pr|ext> <on|off>`
- `/footerfx item <id> <show|hide|reset>`
- `/footerfx item <id> line <1|2>`
- `/footerfx item <id> zone <left|right>`
- `/footerfx item <id> order <n>`
- `/footerfx item <id> before <other-id>` / `/footerfx item <id> after <other-id>`
- `/footerfx item <id> column <n|off>`
- `/footerfx anchor <line1|line2|all> <gap|left|center|right|spread>`
- `/footerfx gap <min> <max>`
- `/footerfx branch-width <n>`
- `/footerfx mcp-zero <hide|show>`

## Workflow
1. Read current state with `/footerfx`.
2. Apply one focused change at a time (item placement, section, anchor, gap, branch width).
3. Changes persist automatically to the user config; use `/footerfx save project` only when the user explicitly wants project-specific layout.
4. Prefer minimal-density defaults:
   - keep `cwd`, `stats`, `model`, `branch` on
   - show `pr` when relevant
   - hide noisy zero-state indicators (`mcp-zero hide`)
5. If the user dislikes custom-footer behavior, run `/footerfx off`.

## Presets
### Compact
- `/footerfx anchor all left`
- `/footerfx gap 1 8`
- `/footerfx branch-width 18`
- `/footerfx section ext off`

### Balanced
- `/footerfx anchor line1 right`
- `/footerfx anchor line2 right`
- `/footerfx item model line 1`
- `/footerfx item model zone right`
- `/footerfx item model before branch`
- `/footerfx item ext line 2`
- `/footerfx item ext zone right`
- `/footerfx gap 2 16`
- `/footerfx branch-width 22`
- `/footerfx section ext on`

### Default Pi feel
- `/footerfx off`
