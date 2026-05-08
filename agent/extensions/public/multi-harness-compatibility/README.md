# pi-multi-harness-compat

Profile-aware compatibility for Claude, Cursor, and other harness resources in Pi.

Use this extension when a repository or organization shares agent resources across Claude, Cursor, Codex-style skill directories, Pi, and other harnesses, but those resources should not always be loaded globally.

For fully normalized context, start Pi with `--no-context-files` and let this extension inject deduplicated context.

## Configuration

Create `~/.pi/agent/multi-harness-compatibility.json` for global profiles, or `.pi/multi-harness-compatibility.json` in a project. Project config is discovered from the current working directory upward to the git root, so starting Pi in a subdirectory still picks up the repo config.

```json
{
  "defaultProfile": "private",
  "profiles": {
    "private": {
      "pi": true,
      "claude": false,
      "cursor": false
    },
    "org": {
      "match": {
        "paths": ["~/code/org/**"],
        "gitRemotes": ["*github.com*my-org*"],
        "markerFiles": [".org-agent-profile"]
      },
      "roots": ["~/code/org/.agent-shared"],
      "pi": true,
      "claude": true,
      "cursor": true
    }
  }
}
```

## Behavior

- Active profile is selected by `match`, otherwise `defaultProfile`.
- Without config, the default `private` profile loads in-repo `AGENTS.md`, `CLAUDE.md`, `.agents/skills`, `.claude/skills`, and `.cursor` resources, but does not load org-wide/shared roots unless configured.
- `CLAUDE.md` files that are exactly `@AGENTS.md` are treated as aliases and suppressed.
- Context files are deduped by real path and normalized content hash.
- Skills from `.agents/skills`, `.claude/skills`, and `.cursor/skills` are deduped by real path and skill name.
- Cursor `.cursor/rules/**/*.md` and `.mdc` files are injected only when the active profile enables Cursor.

## Commands and tools

- `/harness-compat status` shows active profile, loaded skill paths, suppressed duplicates, and diagnostics.
- `/harness-compat profile <name>` switches the runtime default profile for the current session.
- `/harness-compat off` switches the runtime profile to `private`.
- `multi_harness_compat_state` is a read-only tool for agents to inspect the same state structurally.
