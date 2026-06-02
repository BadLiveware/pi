# Claude Code MCP Setup

Run code-intelligence as a Claude Code MCP server when another harness needs Pi's read-next maps, outlines, and symbol reads without loading the Pi extension runtime.

## Prerequisites

- Claude Code CLI on `PATH` (`claude --version`).
- Node.js 20 or newer.
- Dependencies installed in `agent/extensions`.
- A repository path to use as the code-intel working directory.

## Source checkout configuration

Create an MCP config file that launches the TypeScript standalone entrypoint:

```json
{
  "mcpServers": {
    "code-intel": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/path/to/pi/agent/extensions/private/code-intelligence/src/standalone/cli.ts",
        "mcp",
        "--cwd",
        "/path/to/repo"
      ]
    }
  }
}
```

Use it for a one-off Claude Code run:

```bash
claude -p \
  --mcp-config /path/to/code-intel-mcp.json \
  --strict-mcp-config \
  --permission-mode bypassPermissions \
  'Use code-intel to outline src/index.ts before deciding what source to read next.'
```

For persistent configuration, use Claude Code's project or user MCP commands instead of `--mcp-config`:

```bash
claude mcp add code-intel -- \
  node --experimental-strip-types \
  /path/to/pi/agent/extensions/private/code-intelligence/src/standalone/cli.ts \
  mcp --cwd /path/to/repo
```

## Available tools

The MCP server exposes read-only tools by default:

- `code_intel_state`
- `code_intel_repo_overview`
- `code_intel_file_outline`
- `code_intel_repo_route`
- `code_intel_test_map`
- `code_intel_impact_map`
- `code_intel_local_map`
- `code_intel_syntax_search`
- `code_intel_read_symbol`
- `code_intel_post_edit_map`

Mutation tools are hidden unless the server starts with `--enable-mutations`:

- `code_intel_replace_symbol`
- `code_intel_insert_relative`

Keep mutations disabled for normal Claude Code use. Claude Code already has edit tools, while code-intel's main value is routing to relevant source and returning stable symbol targets/read hints.

## Path behavior

`--cwd` sets the process working directory. The standalone server defaults to `--path-base auto`, which accepts either repo-root-relative paths or cwd-relative paths for tool fields such as `path`, `paths`, `changedFiles`, and `testPaths`.

Examples:

```json
{"path":"src/index.ts"}
{"changedFiles":["src/index.ts"]}
{"changedFiles":["agent/extensions/private/code-intelligence/src/tool-registry.ts"]}
```

In `auto` mode, code-intel first tries the input as repo-root-relative when that file exists; otherwise it resolves the path relative to `--cwd`. Use `--path-base repo` to force repo-root-relative behavior, or `--path-base cwd` to force cwd-relative behavior.

Claude Code cannot currently supply Pi's session-tracked touched files. For `code_intel_post_edit_map`, pass `changedFiles` or `baseRef` explicitly.

## Smoke test

Use Claude Code print mode with stream JSON when you need visible evidence that the MCP tools were called:

```bash
claude -p --verbose \
  --mcp-config /path/to/code-intel-mcp.json \
  --strict-mcp-config \
  --permission-mode bypassPermissions \
  --output-format stream-json \
  'Use code_intel_file_outline, code_intel_impact_map, and code_intel_read_symbol on the code-intelligence standalone registry. Return the tool names you used and whether the server behaved as a read-next helper.' \
  | tee /tmp/code-intel-cc-smoke.jsonl
```

Expected evidence:

- `tools/list` includes the read-only code-intel tools.
- The run includes calls to `code_intel_file_outline`, `code_intel_impact_map`, and `code_intel_read_symbol`.
- Tool results include `ok:true`, bounded location/source payloads, `readHint` or `nextRead*` fields, and limitations that remind the agent to inspect current source before claims.

## Installed package shape

The package declares a `code-intel` bin. Once this extension is packaged or linked as an executable dependency, the MCP command can be shortened to:

```bash
claude mcp add code-intel -- code-intel mcp --cwd /path/to/repo
```

The source-checkout command remains the reliable local smoke path until a build or installed package wrapper is added.
