# pi-footer-framework

Configurable footer replacement for Pi. It gives you a stable two-line footer and lets you choose which status items appear where.

Use it when the default footer is too cramped, when you want context/model/branch/PR state in predictable places, or when other extensions need a shared place to publish compact status items.

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
/footerfx gap 1 10
/footerfx save user
```

The extension replaces the default footer only while enabled. Disable it with:

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
- `ext` status text from other extensions

Items can be shown/hidden and positioned by line, left/right zone, relative order, or fixed column.

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
| `/footerfx item <id> line <1|2>` | Move an item to a footer line. |
| `/footerfx item <id> zone <left|right>` | Move an item between left/right zones. |
| `/footerfx item <id> before <other-id>` | Place an item before another item. |
| `/footerfx item <id> after <other-id>` | Place an item after another item. |
| `/footerfx item <id> column <n|off>` | Pin or unpin an item column. |
| `/footerfx anchor <line1|line2|all> <gap|left|center|right|spread>` | Control line alignment. |
| `/footerfx gap <min> <max>` | Set spacing bounds. |
| `/footerfx branch-width <n>` | Set max branch label width. |
| `/footerfx-debug` | Show render snapshot, settings, and layout telemetry. |

## Agent tools

The extension exposes two tools so agents can inspect and adjust the footer without asking you to run commands:

- `footer_framework_state`
- `footer_framework_config`

## Extension item API

Other extensions can publish footer items through Pi's event bus:

```ts
pi.events.emit("footer-framework:item", {
  id: "my-extension:status",
  text: "cache warm",
  placement: { line: 2, zone: "right", order: 50 }
});
```

Remove an item with:

```ts
pi.events.emit("footer-framework:item", { id: "my-extension:status", remove: true });
```
