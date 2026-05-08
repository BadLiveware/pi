---
name: multi-harness-compatibility
description: Use when configuring, inspecting, or troubleshooting the multi-harness compatibility extension for Pi profiles, duplicated skills/context, or missing compatibility resources.
---

# Multi-Harness Compatibility

Use the `multi_harness_compat_state` tool first to inspect the active profile, loaded resources, suppressed duplicates, and diagnostics.

Common workflow:
1. Inspect with `multi_harness_compat_state`.
2. If the user wants a profile change for this session, use `/harness-compat profile <name>` or `/harness-compat off`.
3. If the user wants to temporarily use another repo's context and native skills, use `/harness-compat load-project <repo path>`. This is session-scoped: it survives `pi --continue` for the same session but is not written to global/project config.
4. Re-run `multi_harness_compat_state` to verify the effective profile, manual roots, and loaded resources.

For fully normalized context behavior, Pi should be started with `--no-context-files`; otherwise Pi may also load built-in `AGENTS.md` / `CLAUDE.md` context in addition to this extension's normalized context.

Configuration lives in `~/.pi/agent/multi-harness-compatibility.json` globally or `.pi/multi-harness-compatibility.json` per project. Project config is discovered upward to the git root. Without config, the extension loads in-repo neutral `.agents/skills`, `AGENTS.md`, Claude, and Cursor resources by default.

Manual project loads append session state and trigger a resource reload, so discovered skills become native `/skill:<name>` commands in the same session. They also inject context and list discovered skills as additional skill references for the model to read when relevant. Use `/harness-compat unload-project <repo path|all>` to remove session-scoped roots.
