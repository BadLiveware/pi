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
- `/footerfx reset` — reset to defaults
- `/footerfx section <cwd|stats|model|branch|pr|ext> <on|off>`
- `/footerfx gap <min> <max>`
- `/footerfx branch-width <n>`
- `/footerfx mcp-zero <hide|show>`

## Workflow
1. Read current state with `/footerfx`.
2. Apply one focused change at a time (section, gap, branch width).
3. Prefer minimal-density defaults:
   - keep `cwd`, `stats`, `model`, `branch` on
   - show `pr` when relevant
   - hide noisy zero-state indicators (`mcp-zero hide`)
4. If the user dislikes custom-footer behavior, run `/footerfx off`.

## Presets
### Compact
- `/footerfx gap 1 8`
- `/footerfx branch-width 18`
- `/footerfx section ext off`

### Balanced
- `/footerfx gap 2 16`
- `/footerfx branch-width 22`
- `/footerfx section ext on`

### Default Pi feel
- `/footerfx off`
