# pi-footer-framework

A configurable footer framework extension that intentionally owns/hijacks the footer and lets users control layout sections.

This is designed to pair with primitive-emitting extensions (for example `pr-upstream-status` via `pr-upstream:state`).

It ships with a bundled skill (`footer-framework-config`) and advertises it via package metadata + `resources_discover`, so Pi can apply footer tuning commands automatically when this extension is active.

## Behavior

- Replaces the default footer when enabled.
- Keeps a stable 2-line footer layout.
- Composes:
  - cwd, model, branch
  - token/cost stats
  - PR state primitive (if available)
  - extension statuses

## Commands

- `/footerfx` — show current config
- `/footerfx on` — enable framework footer
- `/footerfx off` — disable and restore default footer
- `/footerfx reset` — restore defaults
- `/footerfx section <cwd|stats|model|branch|pr|ext> <on|off>`
- `/footerfx anchor <line1|line2|all> <gap|left|center|right|spread>` — anchor right-side elements
- `/footerfx gap <min> <max>` — spacing controls used by `gap`/`center`/`left` modes
- `/footerfx branch-width <n>` — max branch label width
- `/footerfx mcp-zero <hide|show>` — hide/show `MCP: 0/x servers`
- `/footerfx-debug` — dump latest footer snapshot and settings
  - includes per-line layout telemetry: left/right widths, pad width, right start/end columns, truncation

## Agent automation primitives

The extension exposes tools so the agent can introspect and tune the footer without asking the user to run commands:

- `footer_framework_state` — returns settings + latest rendered footer snapshot + layout telemetry
- `footer_framework_config` — applies the same syntax as `/footerfx ...`

## Notes

- The extension stores latest settings in session custom entries (`footer-framework-state`).
- It listens to event bus topic `pr-upstream:state` for PR primitives.
