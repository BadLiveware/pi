# Claude Code MCP Setup

The standalone MCP server now lives in `/home/fl/code/personal/code-intel/`, the reusable code-intel package consumed by this Pi extension.

For setup, build, CLI, MCP, and smoke-test instructions, use the standalone package documentation:

```text
/home/fl/code/personal/code-intel/docs/claude-code-mcp.md
```

This Pi extension imports reusable behavior through `code-intel/pi-integration` and does not own the standalone CLI/MCP implementation.
