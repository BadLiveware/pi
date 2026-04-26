# pi-footer-framework

Configurable footer replacement for Pi. It owns footer layout, formatting, color, truncation, and placement while other extensions publish structured status/data for it to render.

Use it when you want to customize Pi's footer through a configurable framework that agents can inspect and reconfigure from natural-language prompts.

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

## Showcase

This is a real Pi terminal using TS render closures, theme-aware styles, right-anchored layout, responsive column placement, PR state, and an adapted extension status item:

![Footer framework showcase with cwd, PR, model, token stats, context, and watchdog status](assets/footer-framework-showcase.png)

The screenshot demonstrates:

- combined render output: cwd plus branch/PR label in one item
- token-level styling: labels, model id, thinking level, token stats, context, and cost use different Pi theme colors/attributes
- built-in Pi data: `cwd`, `branch`, `model`, `stats`, `context`, and `pr`
- extension status adaptation: `compaction-continue` status becomes `watchdog:on`
- flexible placement: line 1 and line 2 are right-anchored, while line 3 uses responsive `column` placement for middle and center-right items

<details>
<summary>Config used for the screenshot</summary>

Save this as `~/.pi/agent/footer-framework.config.ts`. The same file ships as `examples/footer-framework.config.ts` in the npm package.

```ts
import type { FooterFrameworkConfig } from "@badliveware/pi-footer-framework";

function shortPath(value: string, maxWidth = 48, tailSegments = 2): string {
  const normalized = value.replace(/^\/home\/[^/]+/, "~");
  const prefix = normalized.startsWith("~/") ? "~/" : normalized.startsWith("/") ? "/" : "";
  const parts = normalized.slice(prefix.length).split("/").filter(Boolean);
  const compact = parts.length > tailSegments ? `${prefix}…/${parts.slice(-tailSegments).join("/")}` : normalized;
  return compact.length > maxWidth ? `…${compact.slice(-(maxWidth - 1))}` : compact;
}

const config = {
  enabled: true,
  lineAnchors: { 1: "right", 2: "right", 3: "left" },
  minGap: 2,
  maxGap: 24,
  items: {
    branch: { visible: false },
    ext: { visible: false },
    cwd: {
      visible: true,
      line: 1,
      zone: "left",
      order: 10,
      render: ({ pi, span, fn }) => [
        span("cwd", "muted"),
        " ",
        span(shortPath(pi.cwd.trim(), 48, 2), "dim"),
        span(" · ", "muted"),
        span(fn.truncate(pi.branch?.label ?? "", 22), "accent"),
      ],
    },
    model: {
      visible: true,
      line: 1,
      zone: "right",
      order: 10,
      render: ({ pi, span }) => [
        span("model:", "muted"),
        span(pi.model.id ?? "no-model", "accent"),
        span("/", "muted"),
        span(pi.model.thinking ?? "", "thinkingXhigh,bold"),
      ],
    },
    stats: {
      visible: true,
      line: 2,
      zone: "left",
      order: 10,
      render: ({ pi, span }) => [
        span("↑", "dim"), span(pi.stats.inputText ?? "0", "dim"), " ",
        span("↓", "dim"), span(pi.stats.outputText ?? "0", "dim"), " ",
        span("$", "accent"), span(pi.stats.costText ?? "0.000", "success"),
      ],
    },
    context: {
      visible: true,
      line: 3,
      zone: "left",
      order: 10,
      column: "50%",
      render: ({ pi, span }) => {
        if (!pi.context) return undefined;
        const tone = pi.context.tone ?? "muted";
        return [span("ctx", tone), " ", span(pi.context.percentText ?? "?%", tone), " ", span(pi.context.tokenText ?? "?/?", tone)];
      },
    },
    pr: {
      visible: true,
      line: 3,
      zone: "left",
      order: 20,
      column: "66%",
      render: ({ pi, span }) => {
        if (!pi.pr) return undefined;
        return [span("PR ", "muted"), span(pi.pr.checkGlyph ?? "•", pi.pr.checkTone ?? "muted"), span(pi.pr.commentsText ?? "", "muted")];
      },
    },
  },
  adapters: {
    watchdog: {
      source: "extensionStatus",
      key: "compaction-continue",
      itemId: "watchdog",
      match: "(on|off)",
      group: 1,
      urlPath: "url",
      placement: { visible: true, line: 2, zone: "right", order: 20 },
      render: ({ value, span }) => [span("watchdog:", "muted"), span(value ?? "", "accent,bold")],
    },
  },
} satisfies FooterFrameworkConfig;

export default config;
```

String `column` positions such as `"50%"`, `"66%"`, and `"center"` are resolved from the current terminal width, so they keep their relative position after resize. Numeric columns remain fixed absolute terminal columns.

</details>

## How it works

Footer-framework renders normalized footer items from adapter mappings, direct TS/JS item renderers, and extension-published items. Adapter mappings can read three source types:

| Source | Use it for |
| --- | --- |
| `pi` | Built-in Pi/session/footer data such as `cwd`, `model`, `stats`, `context`, `branch`, `pr`, and `extensionStatuses`. |
| `extensionStatus` | Existing `ctx.ui.setStatus()` footer/status entries from other extensions. |
| `sessionEntry` | The latest custom session entry written by an extension with `pi.appendEntry()`. |

The built-in footer items (`cwd`, `model`, `branch`, `stats`, `context`, `pr`) are regular default adapters unless you replace them with `items.<id>.render` in TS/JS config. User/project config overrides built-in defaults and producer hints.

Agents can inspect concise footer-relevant data with `footer_framework_sources`, then add adapter rules with `footer_framework_adapter_config` or adjust layout with `footer_framework_config`. Runtime metadata such as tools, commands, skills, descriptions, and `sourceInfo` is opt-in via `includeTools`, `includeCommands`, `includeSkills`, and `includeDetails`.

## Templates and styles

Adapters can render with a restricted Liquid-style interpolation subset:

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
| `pi.branch.name`, `pi.branch.label` | Git branch values. Use `truncate` in templates when you want a shorter display. |
| `pi.pr.number`, `pi.pr.url`, `pi.pr.checkGlyph`, `pi.pr.checkTone`, `pi.pr.commentsText` | Pull request state when available. |

Supported filters:

| Filter | Example |
| --- | --- |
| `style` / `color` | `{{ value | style: "accent,bold" }}` |
| `bg` / `background` | `{{ value | bg: "toolSuccessBg" }}` |
| `bold`, `italic`, `underline`, `inverse`, `strikethrough` | `{{ value | underline }}` |
| `link` | `{{ pi.pr.number | link: pi.pr.url }}` |
| `truncate` | `{{ pi.branch.label | truncate: 22 }}` limits any value to 22 cells with an ellipsis. |
| `compactPath` | `{{ pi.cwd | compactPath: 48, 2 }}` keeps the last 2 path segments when the path is wider than 48 cells. |
| `default` | `{{ data.state | default: "unknown" }}` |

Style strings use Pi theme tokens and text attributes. Foreground examples: `accent`, `muted`, `dim`, `success`, `warning`, `error`, `text`, `mdLink`, `toolDiffAdded`, and the other Pi theme foreground tokens. Backgrounds use `bg:<token>`, such as `bg:toolSuccessBg`. Attributes are `bold`, `italic`, `underline`, `inverse`, and `strikethrough`.

## TypeScript render config

For personal formatting logic, use a normal TS/JS config file with render closures. Footer-framework still owns data collection, layout, clipping, diagnostics, and final rendering; the closure only returns text/spans for one item.

```ts
import type { FooterFrameworkConfig } from "@badliveware/pi-footer-framework";

function shortPath(value: string, maxWidth = 48, tailSegments = 2) {
  const normalized = value.replace(/^\/home\/[^/]+/, "~");
  const prefix = normalized.startsWith("~/") ? "~/" : normalized.startsWith("/") ? "/" : "";
  const parts = normalized.slice(prefix.length).split("/").filter(Boolean);
  const compact = parts.length > tailSegments ? `${prefix}…/${parts.slice(-tailSegments).join("/")}` : normalized;
  return compact.length > maxWidth ? `…${compact.slice(-(maxWidth - 1))}` : compact;
}

export default {
  items: {
    branch: { visible: false },
    ext: { visible: false },
    cwd: {
      line: 1,
      zone: "left",
      order: 10,
      render: ({ pi, span, fn }) => [
        span("cwd", "muted"),
        " ",
        span(shortPath(pi.cwd.trim(), 48, 2), "dim"),
        span(" · ", "muted"),
        span(fn.truncate(pi.branch?.label ?? "", 22), "accent"),
      ],
    },
  },
} satisfies FooterFrameworkConfig;
```

Render functions are synchronous and may return strings, spans, arrays, `null`, or `undefined`. Use `span(text, style, { url })` for token-level style/link metadata and `fn.text`, `fn.width`, `fn.truncate`, or `fn.compactPath` for footer-safe helpers. Adapter render functions also receive `value`, `label`, `status`, `data`, `url`, and `source`.

`/footerfx-debug`, `footer_framework_state`, and `footer_framework_sources` show which TS/JS renderers loaded plus each rendered item's final tokens, width, placement, and diagnostics. If a render closure throws or returns a promise, the footer item is skipped and a diagnostic is recorded.

## Configuration files

User settings persist to:

```text
~/.pi/agent/footer-framework.json
```

Optional user TS/JS config files live next to it:

```text
~/.pi/agent/footer-framework.config.ts
~/.pi/agent/footer-framework.config.js
```

Project settings can override them:

```text
<project>/.pi/footer-framework.json
<project>/.pi/footer-framework.config.ts
```

Load order is defaults, user TS/JS, user JSON, project TS/JS, then project JSON. `/footerfx` commands write JSON overrides; they do not rewrite TS/JS source. Use `/footerfx save project` only when you intentionally want a project-specific footer layout.

## Commands

| Command | What it does |
| --- | --- |
| `/footerfx` | Show current config and source. |
| `/footerfx on` / `/footerfx off` | Enable or disable the replacement footer. |
| `/footerfx config` | Show loaded config source and config paths. |
| `/footerfx load` | Reload user/project config files. |
| `/footerfx save user` | Save current settings as the user default. |
| `/footerfx save project` | Save current settings for the current project. |
| `/footerfx reset` | Restore defaults and persist them to user config. |
| `/footerfx section <cwd|stats|context|model|branch|pr|ext> <on|off>` | Convenience alias for item visibility. |
| `/footerfx item <id> <show|hide|reset>` | Control item visibility. |
| `/footerfx item <id> line <n>` / `row <n>` | Move an item to any positive footer line. |
| `/footerfx item <id> zone <left|right>` | Move an item between left/right zones. |
| `/footerfx item <id> before <other-id>` / `after <other-id>` | Place an item relative to another item. |
| `/footerfx item <id> column <n|center|middle|percent|off>` | Pin, center, percentage-place, or unpin an item. Percent examples: `50%`, `66%`. |
| `/footerfx anchor <line|all> <gap|left|center|right|spread>` | Control line alignment. `line3` and `3` both work. |
| `/footerfx adapter` | List configured adapters. |
| `/footerfx adapter <id> pi <source-key> [label]` | Adapt a built-in Pi source. |
| `/footerfx adapter <id> status <status-key> [label]` | Adapt an existing extension status key. |
| `/footerfx adapter <id> custom <custom-type> <path> [label]` | Adapt the latest matching custom session entry. |
| `/footerfx adapter <id> template <template>` | Set the adapter's render template. |
| `/footerfx adapter <id> empty-template <template>` | Set the template used for an empty adapter value. |
| `/footerfx adapter <id> style <style>` | Apply a default style to the rendered adapter text. |
| `/footerfx adapter <id> remove` | Remove an adapter. For built-ins, hide the item with `/footerfx item <id> hide`. |
| `/footerfx gap <min> <max>` | Set spacing bounds. |
| `/footerfx-debug` | Show render snapshot, settings, template/render diagnostics, loaded TS/JS renderers, and layout telemetry. |

## Agent tools

The extension exposes tools so agents can inspect and adjust the footer without asking you to run commands:

- `footer_framework_state`
- `footer_framework_sources`
- `footer_framework_config`
- `footer_framework_adapter_config`

`footer_framework_sources` is concise by default. Pass `includeTools`, `includeCommands`, `includeSkills`, and `includeDetails` only when runtime metadata is directly useful.

## Extension data API

Compatible extensions should publish data, not pre-rendered layout. The framework decides final text, color, position, and truncation. Producers may include hints, but user config wins.

```ts
pi.events.emit("footer-framework:item", {
  id: "cache:status",
  label: "cache",
  value: "warm",
  tone: "success",
  data: { entries: 42 },
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

## Troubleshooting

### Blank space below the footer

If blank rows sometimes appear below the footer and disappear after you send a prompt, check `/footerfx-debug` or `footer_framework_state`. When `lastFooterSnapshot.lines` contains only the expected footer lines, the framework is not rendering extra rows. This is usually Pi's TUI viewport/differential rendering leaving unused terminal space below the last rendered component.

A Pi-side workaround is `terminal.clearOnShrink: true` in `~/.pi/agent/settings.json`, but that can add redraw flicker. Footer-framework does not change this setting.
