# pi-footer-framework

A configurable footer framework extension that intentionally owns/hijacks the footer and lets users control layout sections.

This is designed to pair with primitive-emitting extensions (for example `pr-upstream-status` via `pr-upstream:state`).

It ships with a bundled skill (`footer-framework-config`) and advertises it via package metadata + `resources_discover`, so Pi can apply footer tuning commands automatically when this extension is active.

## Behavior

- Replaces the default footer when enabled.
- Keeps a stable 2-line footer layout.
- Composes built-in footer items:
  - `cwd`, `model`, `branch`, `stats`, `pr`, `ext`
- Supports extension-provided dynamic items via the event bus.
- Lets users position each item independently by line, left/right zone, relative order, or absolute column.

## Persistence

Footer settings automatically persist to the user config file by default:

```text
~/.pi/agent/footer-framework.json
```

If a project config exists, it overrides user settings for that project:

```text
<project>/.pi/footer-framework.json
```

Use `/footerfx save project` to intentionally create/update the project config.

## Commands

- `/footerfx` — show current config and source
- `/footerfx config` — show user/project config paths and loaded source
- `/footerfx load` — reload user/project config files
- `/footerfx save user` — save current settings to user config
- `/footerfx save project` — save current settings to project config
- `/footerfx on` — enable framework footer
- `/footerfx off` — disable and restore default footer
- `/footerfx reset` — restore defaults and persist to user config
- `/footerfx section <cwd|stats|model|branch|pr|ext> <on|off>` — legacy section toggles
- `/footerfx item <id> <show|hide|reset>`
- `/footerfx item <id> line <1|2>`
- `/footerfx item <id> zone <left|right>`
- `/footerfx item <id> order <n>`
- `/footerfx item <id> before <other-id>` / `/footerfx item <id> after <other-id>`
- `/footerfx item <id> column <n|off>` — absolute column placement
- `/footerfx anchor <line1|line2|all> <gap|left|center|right|spread>` — line-level right-zone anchoring
- `/footerfx gap <min> <max>` — spacing controls used by `gap`/`center`/`left` modes
- `/footerfx branch-width <n>` — max branch label width
- `/footerfx mcp-zero <hide|show>` — hide/show `MCP: 0/x servers`
- `/footerfx-debug` — dump latest footer snapshot and settings
  - includes per-line layout telemetry: left/right widths, pad width, right start/end columns, truncation

## Extension item API

Other extensions can contribute footer items by emitting:

```ts
pi.events.emit("footer-framework:item", {
  id: "my-extension:status",
  text: "cache warm",
  placement: { line: 2, zone: "right", order: 50 }
});
```

Remove an item:

```ts
pi.events.emit("footer-framework:item", { id: "my-extension:status", remove: true });
```

Users can then reposition the item with `/footerfx item my-extension:status ...` and those overrides persist automatically.

## Agent automation primitives

The extension exposes tools so the agent can introspect and tune the footer without asking the user to run commands:

- `footer_framework_state` — returns settings + latest rendered footer snapshot + layout telemetry
- `footer_framework_config` — applies the same syntax as `/footerfx ...`

## Notes

- The extension stores latest settings in session custom entries (`footer-framework-state`).
- It listens to event bus topic `pr-upstream:state` for PR primitives.
- Extension statuses with empty rendered text are ignored so transient or
  intentionally-cleared status providers do not leave phantom separators in the
  footer.
