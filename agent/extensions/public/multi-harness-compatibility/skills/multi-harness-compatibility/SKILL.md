---
name: multi-harness-compatibility
description: Use when configuring, inspecting, or troubleshooting the multi-harness compatibility extension for Pi profiles, duplicated skills/context, or missing compatibility resources.
---

# Multi-Harness Compatibility

Use the `multi_harness_compat_state` tool first to inspect the active profile, loaded resources, suppressed duplicates, and diagnostics.

Common workflow:
1. Inspect with `multi_harness_compat_state`.
2. If the user wants a profile change for this session, use `/harness-compat profile <name>` or `/harness-compat off`.
3. Re-run `multi_harness_compat_state` to verify the effective profile and loaded resources.

For fully normalized context behavior, Pi should be started with `--no-context-files`; otherwise Pi may also load built-in `AGENTS.md` / `CLAUDE.md` context in addition to this extension's normalized context.

Configuration lives in `~/.pi/agent/multi-harness-compatibility.json` globally or `.pi/multi-harness-compatibility.json` per project. Project config is discovered upward to the git root. Without config, the extension loads in-repo neutral `.agents/skills`, `AGENTS.md`, Claude, and Cursor resources by default.
