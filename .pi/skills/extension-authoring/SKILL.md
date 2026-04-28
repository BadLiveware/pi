---
name: extension-authoring
description: Use when creating, editing, packaging, or reviewing Pi extensions in this repository.
---

# Extension Authoring

Design extensions as agent-operable systems: the user should be able to ask for a behavior change in plain language, and the agent should have tools to inspect current state, apply a focused change, observe the result, and iterate without editing extension source.

## Core Pattern: Agent Feedback Loop

For configurable or stateful extensions, expose capabilities that let the agent close the loop alongside any slash commands:

1. **Introspect** — see current settings, loaded config paths, diagnostics, and the latest rendered/effective runtime snapshot.
2. **Discover options** — see meaningful inputs, available data, valid targets, or configurable surfaces; default to concise data and make expensive metadata opt-in.
3. **Change behavior** — apply one focused config or state change through the same parser/path used by user commands.
4. **Verify/debug** — see raw diagnostics and the new effective state after a change.

These capabilities can be one tool, several tools, commands plus tools, or another structured interface. Do not require the exact `_state`, `_sources`, `_config` shape; require the agent to have a meaningful way to inspect the running extension and change it safely.

The footer framework is one reference pattern:
- `footer_framework_state` lets the agent see settings and the latest rendered footer snapshot.
- `footer_framework_sources` exposes adaptable Pi, extension, and session data with optional runtime metadata.
- `footer_framework_adapter_config` and `footer_framework_config` let the agent make precise, persistent changes.
- `/footerfx` stays user-friendly while tools give the agent structured access.

## When to Add an Agent-Operable Interface

Add an introspection/change interface when:
- the extension has layout, rules, adapters, filters, prompts, schedules, or other user-tunable behavior
- the user may ask the agent to “make this cleaner,” “configure X,” “show Y,” or “fix the display”
- correctness depends on observing runtime state, generated output, or diagnostics
- a command exists for humans but natural-language agent control should be reliable

Do not add tools for static behavior that has no meaningful state or user-tunable configuration.

## Interface Design Rules

- Name tools with a stable extension prefix. Use names that describe capabilities, such as `<extension>_state`, `<extension>_sources`, `<extension>_config`, `<extension>_debug`, or a single `<extension>_manage` tool with explicit actions.
- Keep tool descriptions action-specific; say what the tool returns or changes.
- Return concise `content` for the model and richer structured `details` for rendering/debugging.
- Make list/state calls safe and read-only.
- Make mutation calls narrow, reversible where practical, and explicit about persistence.
- Share implementation between slash commands and tools so behavior cannot drift.
- Include diagnostics in introspection output instead of requiring the agent to infer failures from display text.
- Truncate or summarize large source inventories; add boolean/detail parameters for optional expansion.
- If a tool accepts file paths, normalize a leading `@` and use Pi file mutation queues for writes.
- If configuration persists, document user/project paths and report which path changed.

## Slash Commands vs Agent Tools

Use both when the extension is user-configurable:

- Slash commands optimize for direct human use: terse syntax, notifications, quick toggles, and discoverability.
- Tools optimize for autonomous agent work: structured parameters, structured results, idempotent reads, explicit diagnostics, and safe mutation actions.
- A companion skill should teach the agent the intended workflow and examples of common configuration changes.

Avoid forcing the agent to scrape command output when a structured tool can expose the same state directly.

## Extension Skills

Ship a skill with an extension when natural-language operation matters. Register it with `resources_discover` from the extension package, as footer-framework does with `skills/footer-framework-config`.

The skill should include:
- trigger conditions in the description only
- the normal workflow: inspect running state, discover options if needed, apply one change, re-check effective state
- command and tool names exactly
- safe defaults, persistence behavior, and fallback/reset commands
- examples of user requests mapped to tool/command actions

## Implementation Checklist

Before finishing an extension change:
- Read relevant Pi extension docs and existing nearby extension patterns.
- Keep package runtime dependencies in `dependencies`; do not rely on dev-only packages at runtime.
- Add `package.json` `pi.extensions` entries for packaged extensions.
- Use `typebox` schemas and `StringEnum` for string enum tool parameters.
- Keep mutable runtime state reconstructable from session entries, tool result `details`, config files, or external source of truth.
- Clean up timers, watchers, sockets, or processes on `session_shutdown`.
- Use `ctx.ui.setStatus` for simple status and custom tools/events/session entries for structured data.
- For public extensions, use the `public-extension-readme` skill for README changes.

## Validation

Match validation to the change:
- Run the extension workspace typecheck when TypeScript changed.
- Exercise the introspection and mutation interface with representative data when adding agent-operable configuration.
- For natural-language configuration flows, run a small skill-style behavior check: ask an agent how it would configure the extension and verify it inspects running state before mutating and re-checks the effective state after.
- Verify linked/live layout with `./link-into-pi-agent.sh` when changing files under `agent/` that should appear in `~/.pi/agent`.
