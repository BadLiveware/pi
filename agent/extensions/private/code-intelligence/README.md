# Pi Code Intelligence

Private local Pi extension for evaluating advisory Tree-sitter read-next maps inside Pi.

Use it to prepare compact candidate file lists for reviews and edits. The product surface is intentionally small:

- `code_intel_impact_map`
- `code_intel_local_map`
- `code_intel_syntax_search`
- `code_intel_state`

It does not replace source inspection, language servers, compiler/type checks, tests, or project-native validation.

## When to Use It

Use code-intel when you need a bounded candidate file list before a non-trivial review/edit:

- A diff touches exported functions, shared helpers, handlers, config/schema/protocol paths, or multiple files.
- You need to delegate review and want to pass a compact list of likely caller/consumer/test files.
- You have a scoped subsystem with central anchors plus related field/type/API names.
- You need to find an explicit AST shape or API call pattern in current source.

Do **not** use this extension as a general exact-reference engine. Tree-sitter rows are current-source syntax evidence, not authoritative semantic references. Use language servers such as `gopls`, TypeScript language services, or Rust Analyzer when exact references matter.

Commands shaped like `rg -n "func Foo|Foo.*Bar|Bar" src/**/*.go | sed -n ...` are often ad hoc context mapping. Prefer `code_intel_impact_map` for diffs/changed symbols and `code_intel_local_map` for scoped subsystems, then use `rg` for literal fallback, generated text, comments/docs, or unsupported-language gaps.

Use returned locations to choose files to read next; do not treat the result as exhaustive proof.

## Engines

| Engine | Used for | Artifact behavior |
| --- | --- | --- |
| Tree-sitter WASM | current-source definitions, call candidates, selector/member fields, keyed/object-literal fields, local maps, and syntax search | no index |
| rg | bounded literal fallback in local maps and human follow-up searches | no index |

Cymbal, sqry, and ast-grep are intentionally not part of the normal extension path anymore.

## Design Rationale

The extension is optimized for agent routing, not replacing source reads or project validation.

| Decision | Rationale |
| --- | --- |
| Tree-sitter first (`syn`) | Current-source syntax maps gave the useful read-next evidence without stale indexes, shelling out, or repo-local artifacts. |
| Keep `rg` as literal fallback | Text is still useful for comments, docs, generated files, and unsupported-language gaps, but should be labeled separately from syntax evidence. |
| Small tool surface | The extension is about read-next routing, not exposing a general semantic database or experimental edit API. |
| Default broad map tools to `detail: "locations"` | Agents usually read/edit returned files next, so inline snippets would duplicate source context. Use `detail: "snippets"` only for triage. |
| Summaries before pagination | `fileCount` and `topFiles` show distribution and hidden breadth without encouraging agents to browse pages mechanically. |
| Compact TUI cards, full structured JSON for the agent | The UI stays readable while agent-facing content remains available for reasoning and follow-up tool calls. |
| Passive usage logs, no agent-facing usage tool | We can evaluate natural adoption without adding a tool that changes normal agent behavior. |

## Evaluation Notes

- 2026-04-28: Initial prompt tests showed agents naturally chose code-intel tools, but overused detailed diagnostics. Guidance now keeps diagnostics for error/debug paths.
- 2026-04-29: Cymbal/sqry/ast-grep were evaluated and found useful for exploration but too uneven or too much operational surface for the default read-next product boundary.
- 2026-04-29: A `@vscode/tree-sitter-wasm` prototype on promshim produced correct current-source locations for `buildMatchedSeriesSQL` calls plus `NeedTags` field declarations, selector expressions, and keyed literals.
- 2026-04-29: Tree-sitter became the default map/search engine. `impact_map`, `local_map`, and `syntax_search` no longer shell out to Cymbal/sqry/ast-grep.
- 2026-04-29: The extension was simplified to Tree-sitter plus bounded `rg` literal fallback; low-level Cymbal/sqry symbol/reference/edit tools were removed.

## Footer Status

The extension sets Pi extension status under the key `code-intel`:

- `ci:checking` while probing on session start.
- `ci syn:ok · rg:ok` style summaries after state checks. `syn` is the in-process Tree-sitter parser lane and `rg` is the literal fallback lane.
- `ci:error` if status probing fails.

Status words: `ok` means available, `missing` means the fallback binary is missing, and `err` means the status probe failed.

Footer-framework can show it by adapting extension status `code-intel`, for example:

```text
/footerfx adapter code-intel status code-intel
/footerfx item code-intel line 2
/footerfx item code-intel zone right
```

Tool results use compact TUI cards: the default view shows a short status/count summary, while expanded rows show bounded file/caller/match details. The full JSON content is still returned to the agent.

## Inspecting Errors

The footer is intentionally compact. To inspect details, call:

```json
{"includeDiagnostics": true}
```

with `code_intel_state`. The diagnostic payload includes config diagnostics, backend probe diagnostics, recent runtime operations, and the JSONL log path.

Runtime diagnostics are best-effort: they are written to a small cache log and are meant for local debugging, not as proof of code impact.

## Usage Tracking

The extension passively records low-cardinality local usage metadata to help evaluate whether agents actually use the code-intelligence tools well. It does not register an agent-facing usage-inspection tool by default.

Default log directory:

```text
~/.cache/pi-code-intelligence/usage/
```

Each session writes its own `<session-id>.jsonl` file to avoid contention between concurrent Pi sessions. Set `PI_CODE_INTEL_USAGE_LOG` only when you explicitly want a single-file override for tests/debugging.

Recorded metadata includes tool names, timestamps, repo/cwd, sanitized parameter shapes, result counts/status, duration, and coarse adjacent-tool categories such as `read`, `edit`, `bash:search`, or `bash:test`.

Not recorded by default: prompts, full tool outputs, file contents, raw shell commands, raw search queries, raw edit text, or raw code-intel symbol/query/pattern values.

Use the log manually when evaluating this private extension, for example:

```bash
tail -n 40 ~/.cache/pi-code-intelligence/usage/*.jsonl
```

## Tools

### `code_intel_state`

Inspect Tree-sitter and `rg` availability, config paths, loaded config, limitations, and optional diagnostics.

Use this first when parser availability, missing `rg`, or footer status matters. It also refreshes the `code-intel` footer status. Omit `includeDiagnostics` for routine checks; use `includeDiagnostics: true` for footer errors or failed parser/fallback probes.

### `code_intel_impact_map`

Build the primary candidate read-next impact map from:

- explicit `symbols`
- `changedFiles` expanded through current-source Tree-sitter definitions
- optional `baseRef` using `git diff --name-only <baseRef> --`

The output groups roots and related caller/consumer candidates, with truncation and limitation metadata. Defaults are intentionally tight: up to 20 root symbols after changed-file expansion and 25 related rows unless overridden. `detail: "locations"` is the default so impact maps route agents to files without duplicating source context. Use `detail: "snippets"` only when inline context helps triage without immediate reads.

Rows such as `syntax_call`, `syntax_selector`, and `syntax_keyed_field` have current file/line/column locations and enclosing function names where available, but they are syntax candidates, not type-resolved references.

When delegating review, run this in the parent and pass the roots, candidate files, reasons, coverage limits, and validation gaps to the reviewer. Builtin subagents may not have code-intel tools.

### `code_intel_local_map`

Build a scoped local read-next map from central anchors plus related names. This is the convenience tool for replacing compound context-gathering commands such as:

```bash
rg -n "func lowerAggregation|aggregation.*RequiredTagLabels|RequiredTagLabels" internal/promshim/native/renderer/aggregation* internal/promshim/native/renderer/lower*.go
```

Example:

```json
{
  "anchors": ["lowerAggregation"],
  "names": ["RequiredTagLabels"],
  "paths": ["internal/promshim/native/renderer"],
  "language": "go",
  "detail": "locations"
}
```

The tool combines Tree-sitter current-source map rows, optional selector syntax matches like `$X.RequiredTagLabels`, and bounded `rg` literal fallback, then returns suggested files to read next. Use standalone `rg` afterward for comments/docs, generated text beyond the returned cap, or unsupported-language gaps.

### `code_intel_syntax_search`

Run a read-only in-process Tree-sitter search for an explicit pattern. Results include a `summary` over all parsed matches, including `fileCount`, `topFiles`, and `returnedFileCount`.

Supported convenience patterns currently include calls such as `authenticate($A)`, selectors/properties such as `$OBJ.NeedTags`, keyed fields/object-literal properties such as `NeedTags: $VALUE`, wrapper patterns containing those shapes, and raw Tree-sitter S-expression queries with captures. Use `selector` when you want a specific node kind or capture.

`detail: "snippets"` is the default because syntax matches often need the matched text to judge relevance. Use `detail: "locations"` when matches are just read/edit targets.

Examples:

```json
{
  "pattern": "authenticate($A)",
  "language": "ts",
  "paths": ["src/"],
  "maxResults": 25,
  "detail": "locations"
}
```

```json
{
  "pattern": "func _() { if $OBJ.NeedTags {} }",
  "language": "go",
  "selector": "selector_expression",
  "paths": ["internal/promshim"],
  "detail": "locations"
}
```

```json
{
  "pattern": "(call_expression (identifier) @fn)",
  "language": "ts",
  "selector": "fn",
  "paths": ["agent/extensions/private/code-intelligence"],
  "detail": "snippets"
}
```

The extension never rewrites files through syntax search.

## Evidence Model

Treat every result as advisory routing evidence:

- Good: “these files/callers/syntax matches are worth inspecting.”
- Not enough: “therefore this is definitely broken” or “there are no other impacts.”

Before reporting a review finding or claiming a fix is complete, verify the relevant source and run appropriate project-native checks.

## Config

Optional config files:

- user: `~/.pi/agent/code-intelligence.json`
- project: `.pi/code-intelligence.json`

Project config overlays user config.

Defaults:

```json
{
  "maxResults": 50,
  "queryTimeoutMs": 30000,
  "maxOutputBytes": 5000000
}
```

## Validation

Focused extension tests use small temp repos for determinism:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/code-intelligence/index.test.ts
```

Large repositories under `~/code/external/` or active local projects are useful for manual smoke and usefulness checks, but not required for deterministic tests.
