# pi-footer-framework

Configurable footer replacement for Pi. It owns footer layout and formatting, while compatible extensions publish structured status data for it to place and render.

Use it when the default footer is too cramped, when you want context/model/branch/PR state in predictable places, or when multiple extensions need one shared footer surface.

## Install

```bash
pi install npm:@badliveware/pi-footer-framework
```

No external services or credentials are required.

## Quick use

```text
/footerfx on
/footerfx item context line 1
/footerfx item context after model
/footerfx item pr line 3
/footerfx anchor all right
/footerfx save user
```

The default layout uses two footer lines. If you place an item on another positive line number, the footer grows to include that line. Disable the replacement footer with:

```text
/footerfx off
```

## What it shows

Built-in items include:

- `cwd`
- `model` with thinking level
- `branch`
- `stats`
- `context` usage, such as `ctx 52.2% 142K/272K`
- `pr` state from compatible PR extensions
- `ext` legacy status text from other extensions

Items can be shown/hidden and positioned by line, left/right zone, relative order, or fixed terminal column. User and agent configuration overrides extension-provided hints.

## Configuration

User settings persist to:

```text
~/.pi/agent/footer-framework.json
```

Project settings can override them:

```text
<project>/.pi/footer-framework.json
```

Use `/footerfx save project` only when you intentionally want a project-specific footer layout.

## Commands

| Command | What it does |
| --- | --- |
| `/footerfx` | Show current config and source. |
| `/footerfx on` / `/footerfx off` | Enable or disable the replacement footer. |
| `/footerfx load` | Reload user/project config files. |
| `/footerfx save user` | Save current settings as the user default. |
| `/footerfx save project` | Save current settings for the current project. |
| `/footerfx reset` | Restore defaults and persist them to user config. |
| `/footerfx item <id> <show|hide|reset>` | Control item visibility. |
| `/footerfx item <id> line <n>` | Move an item to any positive footer line. |
| `/footerfx item <id> row <n>` | Alias for `line`. |
| `/footerfx item <id> zone <left|right>` | Move an item between left/right zones. |
| `/footerfx item <id> before <other-id>` | Place an item before another item. |
| `/footerfx item <id> after <other-id>` | Place an item after another item. |
| `/footerfx item <id> column <n|off>` | Pin or unpin an item column. |
| `/footerfx anchor <line|all> <gap|left|center|right|spread>` | Control line alignment. `line3` and `3` both work. |
| `/footerfx gap <min> <max>` | Set spacing bounds. |
| `/footerfx branch-width <n>` | Set max branch label width. |
| `/footerfx-debug` | Show render snapshot, settings, and layout telemetry. |

## Agent tools

The extension exposes two tools so agents can inspect and adjust the footer without asking you to run commands:

- `footer_framework_state`
- `footer_framework_config`

## Extension data API

Compatible extensions should publish data, not pre-rendered layout. The framework decides final text, color, position, and truncation. Producers may include hints, but user config wins.

```ts
pi.events.emit("footer-framework:item", {
  id: "cache:status",
  label: "cache",
  value: "warm",
  tone: "success",
  hint: {
    icon: "◇",
    format: "label-value",
    placement: { line: 2, zone: "right", order: 50 }
  }
});
```

Legacy `text` and top-level `placement` fields still work for existing extensions, but new integrations should prefer `label`, `value`, `status`, `data`, and `hint`.

Remove an item with:

```ts
pi.events.emit("footer-framework:item", { id: "cache:status", remove: true });
```
