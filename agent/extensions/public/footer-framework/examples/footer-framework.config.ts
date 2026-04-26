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
  lineAnchors: {
    1: "right",
    2: "right",
    3: "left",
  },
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
        span("↑", "dim"),
        span(pi.stats.inputText ?? "0", "dim"),
        " ",
        span("↓", "dim"),
        span(pi.stats.outputText ?? "0", "dim"),
        " ",
        span("$", "accent"),
        span(pi.stats.costText ?? "0.000", "success"),
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
        return [
          span("ctx", tone),
          " ",
          span(pi.context.percentText ?? "?%", tone),
          " ",
          span(pi.context.tokenText ?? "?/?", tone),
        ];
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
        return [
          span("PR ", "muted"),
          span(pi.pr.checkGlyph ?? "•", pi.pr.checkTone ?? "muted"),
          span(pi.pr.commentsText ?? "", "muted"),
        ];
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
      render: ({ value, span }) => [
        span("watchdog:", "muted"),
        span(value ?? "", "accent,bold"),
      ],
    },
  },
} satisfies FooterFrameworkConfig;

export default config;
