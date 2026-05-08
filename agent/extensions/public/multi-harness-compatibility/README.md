# pi-multi-harness-compat

Profile-aware compatibility for Claude, Cursor, and other harness resources in Pi.

Use this extension when a repository or organization shares agent resources across Claude, Cursor, Codex-style skill directories, Pi, and other harnesses, but those resources should not always be loaded globally.

For fully normalized context, start Pi with `--no-context-files` and let this extension inject deduplicated context.

## Configuration

Create `~/.pi/agent/multi-harness-compatibility.json` for global profiles, or `.pi/multi-harness-compatibility.json` in a project. Project config is discovered from the current working directory upward to the git root, so starting Pi in a subdirectory still picks up the repo config.

```json
{
  "$schema": "./extensions/public/multi-harness-compatibility/config.schema.json",
  "defaultProfile": "private",
  "profiles": {
    "global": {
      "skillDirs": ["~/.local/share/omarchy/default/omarchy-skill/SKILL.md"]
    },
    "private": {
      "inherit": ["global"],
      "pi": true,
      "claude": false,
      "cursor": false
    },
    "org": {
      "inherit": ["global"],
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

The package includes `config.schema.json` for editor validation. For global config under `~/.pi/agent/`, use:

```json
{
  "$schema": "./extensions/public/multi-harness-compatibility/config.schema.json"
}
```

For project config, point `$schema` at the installed package or a repo-relative copy if your editor cannot resolve the global path.

## Behavior

- Active profile is selected by `match`, otherwise `defaultProfile`.
- Profiles can use `inherit` to merge reusable template profiles such as a `global` profile for always-on skill files. Arrays are concatenated and deduplicated; child boolean settings override inherited booleans.
- Without config, the default `private` profile loads in-repo `AGENTS.md`, `CLAUDE.md`, `.agents/skills`, `.claude/skills`, and `.cursor` resources, but does not load org-wide/shared roots unless configured.
- `CLAUDE.md` files that are exactly `@AGENTS.md` are treated as aliases and suppressed.
- Context files are deduped by real path and normalized content hash.
- Skills from `.agents/skills`, `.claude/skills`, `.cursor/skills`, and configured `skillDirs` are deduped by real path and skill name. `skillDirs` may point at directories or exact standalone `.md` skill files.
- Cursor `.cursor/rules/**/*.md` and `.mdc` files are injected only when the active profile enables Cursor.

## Commands and tools

- `/harness-compat status` shows active profile, manual roots, loaded skill paths, suppressed duplicates, and diagnostics.
- `/harness-compat profile <name>` switches the runtime default profile for the current session.
- `/harness-compat off` switches the runtime profile to `private`.
- `/harness-compat load-project <repo path>` temporarily loads another project root for the current extension runtime, for example `/harness-compat load-project ~/code/external/ClickHouse`.
- `/harness-compat unload-project <repo path|all>` removes temporarily loaded project roots.
- `multi_harness_compat_state` is a read-only tool for agents to inspect the same state structurally.

Manual project loads are intentionally session-scoped and not written to config. They are stored in the current Pi session, so they survive closing Pi and resuming with `pi --continue`, but they do not affect other sessions. Loading or unloading a project triggers a resource reload so discovered skills become native namespaced commands for that session, such as `/skill:clickhouse-review`, avoiding collisions with existing skill names like `/skill:review`. The loaded project's context is injected as normalized context, and discovered skills are also listed as additional references for the model to read when relevant.
