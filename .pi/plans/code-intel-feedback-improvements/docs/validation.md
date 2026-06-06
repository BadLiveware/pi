# Validation Reference

## Standalone package validation

Run from `/home/fl/code/personal/code-intel` when changing reusable code-intel behavior, CLI, MCP, docs, or tests.

```bash
npm run typecheck
npm test
npm run build
npm run smoke:cli
```

For the full standalone package check:

```bash
npm run ci
```

## Pi extension validation

Run from `/home/fl/code/personal/pi/agent/extensions` when changing Pi extension integration, tool prompt snippets, skills, usage tracking, touched-file hooks, footer/status behavior, adapter code, or extension tests.

```bash
npm run typecheck
npm test
npm run eval:code-intel
```

## Package integration validation

Slice 01 chose a local package/library dependency with a `code-intel/pi-integration` facade. Slice 01b should validate:

- standalone package build succeeds before Pi imports it;
- `code-intel/pi-integration` exports tool specs, env/config helpers, repo safety helpers, and diagnostic collection APIs required by Pi;
- Pi extension tests can import the facade through the workspace dependency;
- Pi adapter preserves existing public tool names and schemas;
- `post_edit_map` touched-file defaults still layer Pi session context on top of reusable behavior.

## Cross-repository validation rule

After Slice 01:

- reusable tool behavior should be validated in `/home/fl/code/personal/code-intel` first;
- Pi adapter behavior should be validated in `/home/fl/code/personal/pi/agent/extensions`;
- duplicated Pi mirror validation is only required if a temporary bridge keeps any common source copy alive.

## Smoke checks for output quality

Before and after package adoption, compact-output smoke checks can use the standalone CLI:

```bash
cd /home/fl/code/personal/code-intel
node dist/standalone/cli.js call code_intel_post_edit_map --cwd . --json '{"changedFiles":["README.md"],"maxResults":5}' --format compact
node dist/standalone/cli.js call code_intel_repo_route --cwd . --json '{"terms":["post_edit_map"],"paths":["src","test"],"maxResults":5}' --format compact
```

When validating Pi output specifically, run through the Pi extension test harness rather than only the standalone CLI.
