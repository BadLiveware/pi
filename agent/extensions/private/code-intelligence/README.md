# Pi Code Intelligence

Private local Pi extension for evaluating advisory Tree-sitter read-next maps inside Pi.

Use it to prepare compact candidate file lists for reviews and edits. The product surface is intentionally small:

- `code_intel_repo_overview`
- `code_intel_file_outline`
- `code_intel_test_map`
- `code_intel_repo_route`
- `code_intel_impact_map`
- `code_intel_local_map`
- `code_intel_syntax_search`
- `code_intel_read_symbol`
- `code_intel_post_edit_map`
- `code_intel_state`

It does not replace source inspection, language servers, compiler/type checks, tests, or project-native validation.

## When to Use It

Use code-intel when you need deterministic repository orientation or a bounded candidate file list before a non-trivial review/edit:

- You are entering a large unfamiliar repo and need structure before broad searches.
- You need to route concept/API terms to likely implementation files without dumping raw global `rg` output.
- A diff touches exported functions, shared helpers, handlers, config/schema/protocol paths, or multiple files.
- You need to delegate review and want to pass a compact list of likely caller/consumer/test files.
- You have a scoped subsystem with central anchors plus related field/type/API names.
- You need to find an explicit AST shape or API call pattern in current source.

Do **not** use this extension as a general exact-reference engine. Tree-sitter rows are current-source syntax evidence, not authoritative semantic references. `code_intel_state` reports optional language-server availability for planning/debugging, and `code_intel_impact_map` can run bounded opt-in confirmation for Go, TypeScript/JavaScript, or clangd-backed C/C++ roots when exactness materially matters.

Commands shaped like `rg -n "func Foo|Foo.*Bar|Bar" src/**/*.go | sed -n ...` are often ad hoc context mapping. Prefer `code_intel_impact_map` for diffs/changed symbols and `code_intel_local_map` for scoped subsystems, then use `rg` for literal fallback, generated text, comments/docs, or unsupported-language gaps.

Use returned locations to choose files to read next; do not treat the result as exhaustive proof. Orientation tools present objective paths, counts, languages, imports/includes, declarations, and evidence only; they intentionally do not generate model summaries or semantic role hints.

## Engines

| Engine | Used for | Artifact behavior |
| --- | --- | --- |
| Tree-sitter WASM | current-source definitions, file outlines, capped repo file-tier declarations, call candidates, selector/member fields, keyed/object-literal fields, local maps, and syntax search. Impact maps currently route Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++; C/C++ changed-file routing is scoped for large-repo safety unless explicit paths broaden it. | no index |
| rg | bounded literal fallback in local maps and human follow-up searches | no index |

Optional language-server probes in `code_intel_state` (`gopls`, Rust Analyzer, TypeScript, and clangd availability) are status-only. Exact-reference work is separate and opt-in through `code_intel_impact_map` reference confirmation; default routing remains Tree-sitter plus bounded `rg` fallback. C/C++ clangd confirmation also requires a usable `compile_commands.json` in the repository root or common build directories.

Cymbal, sqry, and ast-grep are intentionally not part of the normal extension path anymore.

## Design Rationale

The extension is optimized for agent routing, not replacing source reads or project validation.

| Decision | Rationale |
| --- | --- |
| Tree-sitter first (`syn`) | Current-source syntax maps gave the useful read-next evidence without stale indexes, shelling out, or repo-local artifacts. |
| Keep `rg` as literal fallback | Text is still useful for comments, docs, generated files, and unsupported-language gaps, but should be labeled separately from syntax evidence. |
| Small tool surface | The extension is about read-next routing, not exposing a general semantic database or experimental edit API. |
| Default broad map tools to `detail: "locations"` | Agents usually read/edit returned files next, so inline snippets would duplicate source context. Use `detail: "snippets"` only for triage. |
| Locator mode vs source mode | Locator tools return `symbolTarget`/`readHint` data without source bodies; `code_intel_read_symbol` returns complete bounded source segments. Do not do both for the same range unless freshness, truncation, or ambiguity requires it. |
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

Tool results use compact TUI cards: the default view shows a short status/count summary, while expanded rows show bounded file/caller/match details. Agent-visible tool `content` is also compact text by default to avoid spending context on repeated JSON keys; the full structured payload remains available in tool `details` for programmatic use and tests.

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

Recorded metadata includes tool names, timestamps, stable per-call invocation ids, repo/cwd, sanitized parameter shapes, returned-file and returned-segment counts/ranks, result counts/status, truncation/max-result hints, duration, and coarse adjacent-tool categories such as `read`, `edit`, `write`, `bash:search`, or `bash:test`. Follow-up records can indicate whether a read/edit/write matched a returned file or source segment and its rank, whether a same-range read likely duplicated a complete segment, or whether a later search/test looked like compensatory search or validation.

Not recorded by default: prompts, full tool outputs, file contents, raw shell commands, raw search queries, raw edit text, or raw code-intel symbol/query/pattern values.

Use the log manually when evaluating this private extension, for example:

```bash
tail -n 40 ~/.cache/pi-code-intelligence/usage/*.jsonl
```

## Tools

### `code_intel_repo_overview`

Build a large-repo-safe orientation map.

Use `tier: "shape"` first for broad scopes such as a repository root. It summarizes directories, file counts, source/test/doc/config buckets, dominant languages, exclusions, caps, and truncation without parsing declarations. Use `tier: "files"` only after scoping to one or a few directories; it lists files and capped top-level declarations per file.

Examples:

```json
{"tier":"shape","maxDepth":2}
```

```json
{"tier":"files","paths":["src/Storages/System"],"maxFilesPerDir":80,"maxSymbolsPerFile":8}
```

The output is filesystem and Tree-sitter syntax evidence for navigation. It does not infer semantic roles such as entrypoints or architectures.

### `code_intel_file_outline`

Parse one file and return imports/includes plus language-native declarations with line ranges. Use this before reading very large source files, or after repo overview identifies a candidate file.

Declaration rows are locator-mode: compact output shows a short stable `ref=<targetRef>` plus `read=<offset>+<limit>`, while structured details include the full `symbolTarget` and `readHint`. `symbolTarget` keeps a stable `targetRef`/`symbolRef`, an exact `rangeId`, and opaque relocation hints for stale-target resolution; normal compact output intentionally hides those relocation hints. Agents can either perform one precise generic `read`, or pass the target directly to `code_intel_read_symbol`. They do not include declaration bodies unless `detail: "snippets"` asks for small triage snippets.

Example compact row:

```text
fn ApiClient::fetchWithRetry:120-180 ref=abc123 read=120+61
```

Example:

```json
{"path":"src/Storages/System/StorageSystemTables.cpp","maxSymbols":250}
```

### `code_intel_test_map`

Return evidence-ranked test candidates for a scoped file, symbol, or domain name. It uses bounded test-root discovery, path/name similarity, and literal matches, so it can find non-code tests such as SQL fixtures as well as source-code tests. Generated/cache/log artifacts are ignored by default, and generic path-only terms are downranked to keep results focused.

Example:

```json
{"path":"src/Storages/System/StorageSystemTables.cpp","symbols":["StorageSystemTables"],"names":["system.tables"],"maxResults":50}
```

Treat results as likely tests to inspect or run, not proof of coverage.

### `code_intel_repo_route`

Rank likely files for concept, API, feature, or function terms using bounded path and literal evidence. Use this after a broad overview when you know terms such as `promql` and `over_time` but do not yet know the implementation file. Scope `paths` in large repositories.

Example:

```json
{"terms":["promql","over_time"],"paths":["src"],"maxResults":20}
```

Route results are file candidates, not semantic proof. Read or outline returned files before making implementation claims.

### `code_intel_read_symbol`

Read one declaration by passing a `symbolTarget` from locator-mode output, or by using explicit `path` plus `symbol`/`owner`/`kind` selectors. Pass-through targets can survive harmless line shifts and nearby sibling insertions by combining stable identity, exact range validation, and opaque before/after relocation anchors; ambiguous matches return alternatives instead of guessing. This is source mode: compact content includes the returned source segment. When it returns `sourceCompleteness: "complete-segment"`, treat the returned segment as the source read and do not generic-read the same range again unless freshness, truncation, ambiguity, or edit context requires it.

Function-like declarations return the full function/method/constructor body by default. `contextLines` is mainly for small declarations and adjacent comments, decorators, attributes, or class/struct context.

Optional `include` values can add bounded one-hop same-file referenced definitions:

```json
{
  "target": { "path": "src/api.ts", "name": "fetchWithRetry", "symbolRef": "..." },
  "include": ["referenced-constants", "referenced-vars", "referenced-types"]
}
```

Referenced context is lexical/AST evidence only. Constants, vars, and types are included when requested; called functions/helpers and fields/properties are reported as deferred rather than recursively expanded.

### `code_intel_post_edit_map`

Build a read-only follow-up map after edits or writes. It returns locator-mode changed symbols, likely caller/consumer rows, likely test candidates, and optional diagnostic-focused declaration targets. It does not run tests, apply fixes, or mutate files.

Examples:

```json
{"changedFiles":["src/api.ts"],"includeCallers":true,"includeTests":true}
```

```json
{
  "changedFiles": ["src/api.ts"],
  "includeDiagnostics": true,
  "diagnostics": [{"path":"src/api.ts","line":42,"column":17,"severity":"error","source":"typescript","code":"TS2345"}]
}
```

Diagnostics prioritize enclosing declarations and validation targets, but remain routing evidence.

### `code_intel_state`

Inspect Tree-sitter, `rg`, and optional language-server availability, plus config paths, loaded config, limitations, and optional diagnostics.

Use this first when parser availability, missing `rg`, optional LSP availability, or footer status matters. It also refreshes the `code-intel` footer status. Omit `includeDiagnostics` for routine checks; use `includeDiagnostics: true` for footer errors or failed parser/fallback probes. LSP status is availability-only, not proof that exact-reference confirmation has been run.

### `code_intel_impact_map`

Build the primary candidate read-next impact map from:

- explicit `symbols`
- `changedFiles` expanded through current-source Tree-sitter definitions
- optional `baseRef` using `git diff --name-only <baseRef> --`

The output groups roots and related caller/consumer candidates, with truncation and limitation metadata. Defaults are bounded but closer to normal agent search habits: up to 20 root symbols after changed-file expansion and 125 location rows unless overridden. `detail: "locations"` is the default so impact maps route agents to files without duplicating source context; snippet output stays tighter at 25 rows by default. Use `detail: "snippets"` only when inline context helps triage without immediate reads.

Impact-map routing currently supports Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++ source files. Rust routing is Tree-sitter syntax evidence only; Rust Analyzer status is reported but not used for exact-reference confirmation. C/C++ changed-file routing defaults to parsing the changed C/C++ files rather than the whole repository, which keeps ClickHouse-scale repositories bounded; pass explicit `paths` if you intentionally want to broaden the Tree-sitter scan. When changed files are non-source or outside the impact-routing set, the result includes `coverage.supportedImpactLanguages`, `coverage.unsupportedImpactFiles`, and `coverage.nonSourceFiles` so agents can fall back deliberately to source reads, `code_intel_syntax_search`, `code_intel_local_map`, or bounded `rg` instead of treating an empty map as a successful review.

Rows such as `syntax_call`, `syntax_selector`, and `syntax_keyed_field` have current file/line/column locations and enclosing function names where available, but they are syntax candidates, not type-resolved references.

For high-value exactness checks, pass `confirmReferences` to run bounded opt-in confirmation for returned roots:

- `"gopls"` runs short-lived `gopls references` confirmation for Go roots.
- `"typescript"` uses the local TypeScript language service for TypeScript/TSX/JavaScript roots.
- `"clangd"` starts a short-lived clangd LSP session for C/C++ roots when a usable `compile_commands.json` is found.

Use `maxReferenceRoots`, `maxReferenceResults`, and `includeReferenceDeclarations` to control scope. The confirmation appears under `referenceConfirmation` with provider evidence labels such as `gopls:references` or `typescript:references`; it is not part of default routing and missing/broken confirmation tooling should not affect the Tree-sitter map.

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
  "maxResults": 125,
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

A small read-next quality fixture is available as a dogfood eval:

```bash
cd agent/extensions
npm run eval:code-intel
```

Large repositories under `~/code/external/` or active local projects are useful for manual smoke and usefulness checks, but not required for deterministic tests.
