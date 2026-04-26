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

- built-in Pi/session/footer data through `pi` sources such as `cwd`, `model`, `stats`, `context`, `branch`, `pr`, and `extensionStatuses`
- `ctx.ui.setStatus()` values through Pi footer status data
- custom session entries written by extensions with `pi.appendEntry()`

Agents can inspect those sources with `footer_framework_sources`, then add adapter rules with `footer_framework_adapter_config` or simple `/footerfx adapter ...` commands. The source tool defaults to concise footer-relevant data; pass `includeTools`, `includeCommands`, `includeSkills`, and `includeDetails` only when runtime metadata is useful for debugging. The default built-in footer items dogfood this same adapter path.

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

## Templates and styles

Adapters can override their rendered text with a small Liquid-style interpolation subset:

```liquid
{{ pi.stats.costText }}
{{ "EUR" }}
{{ "EUR" | style: "accent" }}{{ pi.stats.costText | style: "success,bold" }}
```

Quoted strings are literals. Unquoted terms are variables, so missing variables are reported as template diagnostics instead of being guessed as text. Diagnostics appear in `/footerfx-debug`, `footer_framework_state`, and `footer_framework_sources`.

Useful template context:

| Path | Meaning |
| --- | --- |
| `value`, `label`, `status`, `data`, `url` | The current adapter source. |
| `pi.cwd` | Current working directory. |
| `pi.model.id`, `pi.model.provider`, `pi.model.thinking` | Current model information. |
| `pi.stats.inputText`, `pi.stats.outputText`, `pi.stats.costText` | Formatted session token/cost stats. Raw numbers are `input`, `output`, and `cost`. |
| `pi.context.percentText`, `pi.context.tokenText`, `pi.context.tone` | Context usage and recommended tone. |
| `pi.branch.name`, `pi.branch.compact`, `pi.branch.label` | Git branch values. |
| `pi.pr.number`, `pi.pr.url`, `pi.pr.checkGlyph`, `pi.pr.checkTone`, `pi.pr.commentsText` | Pull request state when available. |

Supported filters:

| Filter | Example |
| --- | --- |
| `style` | `{{ value | style: "accent,bold" }}` |
| `color` | Alias for `style`. |
| `bg` / `background` | `{{ value | bg: "toolSuccessBg" }}` |
| `bold`, `italic`, `underline`, `inverse`, `strikethrough` | `{{ value | underline }}` |
| `link` | `{{ pi.pr.number | link: pi.pr.url }}` |
| `default` | `{{ data.state | default: "unknown" }}` |

Style strings use Pi theme tokens and text attributes. Foreground examples: `accent`, `muted`, `dim`, `success`, `warning`, `error`, `text`, `mdLink`, `toolDiffAdded`, and the other Pi theme foreground tokens. Backgrounds use `bg:<token>`, such as `bg:toolSuccessBg`. Attributes are `bold`, `italic`, `underline`, `inverse`, and `strikethrough`.

Example: combine cwd and branch into one item:

```text
/footerfx adapter cwd-branch pi cwd cwd
/footerfx adapter cwd-branch template {{ pi.cwd | style: "dim" }} {{ "(" | style: "muted" }}{{ pi.branch.compact | style: "accent" }}{{ ")" | style: "muted" }}
/footerfx item branch hide
```

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

## Troubleshooting

### Blank space below the footer

If blank rows sometimes appear below the footer and disappear after you send a prompt, check `/footerfx-debug` or `footer_framework_state`. When `lastFooterSnapshot.lines` contains only the expected footer lines, the framework is not rendering extra rows. This is usually Pi's TUI viewport/differential rendering leaving unused terminal space below the last rendered component.

A Pi-side workaround is `terminal.clearOnShrink: true` in `~/.pi/agent/settings.json`, but that can add redraw flicker. Footer-framework does not change this setting.

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
| `/footerfx adapter <id> template <template>` | Set the adapter's Liquid-style render template. |
| `/footerfx adapter <id> empty-template <template>` | Set the template used for an empty adapter value. |
| `/footerfx adapter <id> style <style>` | Apply a default style to the rendered adapter text. |
| `/footerfx adapter <id> remove` | Remove an adapter. |
| `/footerfx gap <min> <max>` | Set spacing bounds. |
| `/footerfx branch-width <n>` | Set max branch label width. |
| `/footerfx-debug` | Show render snapshot, settings, and layout telemetry. |

## Agent tools

The extension exposes tools so agents can inspect and adjust the footer without asking you to run commands:

- `footer_framework_state`
- `footer_framework_sources` (concise by default; optional `includeTools`, `includeCommands`, `includeSkills`, and `includeDetails` flags expose runtime metadata)
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
