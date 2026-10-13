# pi-subagents upstream adoption

Use upstream **0.78.0**, commit `a4c8ced69a8176cdf4179b127feddc8875e3418f`, without carrying the six fork-only patches. The previous `feat/tool-denylist` branch at `50b55274065f220e3bba5f6f135d30d965b33a8e` remains the rollback source.

## Consumer contracts

- Configure exact-name exclusions with upstream `excludeTools`, not the fork's `denyTools` selectors.
- Use one `subagent` tool: `agent`/`task` for one child, `workflow` scripts with `runs.run`/`runs.all` for sequences and fanout. There is no separate workflow tool; legacy `chain`/`tasks` and template variables are not the default API.
- Selected skills expose names, descriptions and file paths, not their instruction bodies. Children read the selected files when needed.
- Repo roles grant local/private extensions explicitly through `subagentOnlyExtensions`; MCP grants use `mcp:<server>/<tool>`. Existing obsolete web aliases are removed; repository code search uses the configured GitHub server's `search_code` tool.
- Code roles explicitly retain project and global instruction inheritance. Research roles keep their existing narrow context settings. Leaf roles do not acquire nested delegation; fanout requires upstream's explicit tool/config authorization and depth/capability limits.
- Stardock removes `clarify` but retains `async: false`. Its event bridge uses **flat executor parameters** such as `context` and `outputMode`. Do not nest these in `options`: the upstream slash bridge does not lower compact model-tool options, and an explicit fork would silently become fresh. Suggested model-tool JSON from the advisory adapter uses the compact `options.context` schema instead.

The flat/compact distinction was verified with the real native Pi 1.2 bridge: flat fresh/fork calls passed; an intermediate compact bridge payload lost the parent marker in the fork case and was reverted.

## Verification evidence

On native Pi 1.2.0:

- Upstream unit suite: 4,006 passed, 16 skipped, no failures.
- Upstream integration suite: 1,216 passed, 7 skipped, no failures.
- Stardock regression suite: 287 passed, no failures; extension typecheck and structure checks passed.
- Clean-install package smoke: public SDK identity, compiled package loading and coordinator/leaf allowlists passed.
- All 13 repository role profiles: actual extension registration, private code-intelligence invocation where granted, exact tool allowlists, non-delegating boundaries and selected skill discovery passed with a local scripted provider.
- Network-isolated CLI matrix: real Stardock foreground event bridge and detached background execution, each with fresh and forked context; parent-marker checks distinguish the contexts, and background notification/runner-exit checks passed.
- Guidance choice tests passed on enabled `openai-codex/gpt-6.1-sol` and lower-cost `openai-codex/gpt-6-luna`, both with high thinking, after correcting the workflow recipes.

Upstream tests use an isolated npm prefix so globally installed package agents do not replace expected builtins. This isolates the test environment; live package discovery remains upstream's normal behavior.

MCP grant resolution was checked against captured configured-server tool metadata, not live external MCP calls. Role model defaults were not changed: runtime probes use a scripted provider, and guidance tests use explicit enabled overrides. Unrelated local model/instruction edits remain outside the adoption commit.

## Runtime activation

The configured package path remains `~/code/personal/pi-subagents`. Switch that clean checkout to the upstream-rooted adoption branch and install its runtime dependencies before restarting Pi. Existing sessions retain their previously loaded extension; source linking or changing the checkout does not hot-swap that session's tool schema.

Source guidance: [subagent-delegation](../agent/skills/subagent-delegation/SKILL.md). Runtime migration plan and throw-away smoke artifacts are repository-local, not global agent instructions.
