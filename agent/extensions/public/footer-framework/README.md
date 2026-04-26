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

The default built-in items are implemented as adapters over Pi data sources:

- `cwd`
- `model` with thinking level
- `branch`
- `stats`
- `context` usage, such as `ctx 52.2% 142K/272K`
- `pr` state
- `ext` legacy status text from other extensions

Items can be shown/hidden and positioned by line, left/right zone, relative order, or fixed terminal column. User and agent configuration overrides built-in defaults and extension-provided hints.

## Adapting existing extensions

Extensions do not have to explicitly target footer-framework. The framework can adapt data that Pi already exposes:

- built-in Pi/session/footer data through `pi` sources such as `cwd`, `model`, `stats`, `context`, `branch`, `pr`, `tools`, `commands`, and `extensionStatuses`
- `ctx.ui.setStatus()` values through Pi footer status data
- custom session entries written by extensions with `pi.appendEntry()`
- tool and command metadata for discovery

Agents can inspect those sources with `footer_framework_sources`, then add adapter rules with `footer_framework_adapter_config` or simple `/footerfx adapter ...` commands. The default built-in footer items dogfood this same adapter path.

Example: render another extension's existing status key as its own footer item instead of leaving it in the generic `ext` bucket:

```text
/footerfx adapter cache status cache:state cache
/footerfx item cache line 3
/footerfx item cache zone right
```

Example adapter JSON for the agent tool:

```json
{
  "source": "extensionStatus",
  "key": "cache:state",
  "label": "cache",
  "match": "(?<state>warm|cold|rebuilding)",
  "group": "state",
  "tone": "info",
  "format": "label-value",
  "placement": { "line": 3, "zone": "right", "order": 20 }
}
```

For built-in Pi data, use `"source": "pi"` and a source key from `footer_framework_sources.piSources`. For custom session entries, adapters select from the latest entry with a matching `customType`. Paths are small dotted selectors such as `data.state`, `data.items[0].status`, or `$.data.loopName`.

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
| `/footerfx adapter` | List configured adapters. |
| `/footerfx adapter <id> pi <source-key> [label]` | Adapt a built-in Pi source. |
| `/footerfx adapter <id> status <status-key> [label]` | Adapt an existing extension status key. |
| `/footerfx adapter <id> custom <custom-type> <path> [label]` | Adapt the latest matching custom session entry. |
| `/footerfx adapter <id> remove` | Remove an adapter. |
| `/footerfx gap <min> <max>` | Set spacing bounds. |
| `/footerfx branch-width <n>` | Set max branch label width. |
| `/footerfx-debug` | Show render snapshot, settings, and layout telemetry. |

## Agent tools

The extension exposes tools so agents can inspect and adjust the footer without asking you to run commands:

- `footer_framework_state`
- `footer_framework_sources`
- `footer_framework_config`
- `footer_framework_adapter_config`

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
