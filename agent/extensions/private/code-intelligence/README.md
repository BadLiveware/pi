# Pi Code Intelligence

Private local Pi extension for evaluating advisory code-intelligence tools inside Pi.

Use it to prepare compact read-next maps for reviews and edits. The normal product surface is `impact_map`, `local_map`, and scoped `syntax_search`; lower-level symbol/reference tools exist only to explain or refine those maps. It does not replace source inspection, language servers, compiler/type checks, tests, or project-native validation.

## When to Use It

Use code-intel when you need a bounded candidate file list before a non-trivial review/edit:

- A diff touches exported functions, shared helpers, handlers, config/schema/protocol paths, or multiple files.
- You need to delegate review and want to pass a compact list of likely caller/consumer/test files.
- You have a scoped subsystem with central anchors plus related field/type/API names.
- You need to find an explicit AST shape or API call pattern in current source.

Do **not** use this extension as a general exact-reference engine. Tree-sitter rows are current-source syntax evidence, not authoritative semantic references. Use language servers such as `gopls`, TypeScript language services, or Rust Analyzer when exact references matter.

Commands shaped like `rg -n "func Foo|Foo.*Bar|Bar" src/**/*.go | sed -n ...` are often ad hoc context mapping. Prefer `code_intel_impact_map` for diffs/changed symbols and `code_intel_local_map` for scoped subsystems, then use `rg` for literal fallback, generated text, comments/docs, or unsupported-language gaps.

Use returned locations to choose files to read next; do not treat the result as exhaustive proof.

## Backends

| Backend | Used for | Artifact behavior |
| --- | --- | --- |
| Tree-sitter WASM | default current-source definitions, call candidates, selector/member fields, keyed/object-literal fields, local maps, and syntax search | no index |
| Cymbal | legacy low-level source/context/reference experiments only | OS cache per repo by default |
| sqry | legacy graph status/update experiment only; not used by default maps | repo-local artifacts such as `.sqry/` |

ast-grep is no longer used by the default syntax-search lane; supported structural searches run in-process through Tree-sitter queries/pattern adapters.

## Design Rationale

The extension is optimized for agent routing, not replacing source reads or project validation.

| Decision | Rationale |
| --- | --- |
| Tree-sitter first (`syn`) | Current-source syntax maps gave the useful read-next evidence without stale indexes, shelling out, or repo-local artifacts. |
| Keep legacy lanes explicit | Cymbal/sqry remain available for low-level experiments/debugging, but normal maps no longer depend on them. |
| Keep `includeDiagnostics` opt-in | Normal state checks stay small; detailed runtime logs are for footer errors, stale state, or failed update/debug paths. |
| Make `impact_map` and `local_map` the normal entry points | Agents need a read-next queue more than raw backend rows. Low-level tools are kept available for debugging/refinement but are not the product promise. |
| Use Tree-sitter for current-source evidence | The previous Cymbal/sqry lanes were useful but uneven for line-exact routing. Tree-sitter gives deterministic syntax locations for calls, selectors, keyed fields, object-literal fields, and definitions without claiming semantic exactness. |
| Default broad map tools to `detail: "locations"` | Agents usually read/edit returned files next, so inline snippets would duplicate source context. Use `detail: "snippets"` only for triage. |
| Summaries before pagination | `fileCount` and `topFiles` show distribution and hidden breadth without encouraging agents to browse pages mechanically. |
| Compact TUI cards, full structured JSON for the agent | The UI stays readable while agent-facing content remains available for reasoning and follow-up tool calls. |
| Passive usage logs, no agent-facing usage tool | We can evaluate natural adoption without adding a tool that changes normal agent behavior. |

## Why Keep This as a Pi Tool

Tree-sitter WASM is now the default in-process engine. The Pi extension adds value by making it agent-operable:

- **Stable task-level interface:** agents normally choose `impact_map`, `local_map`, or `syntax_search` without learning backend CLI flags; low-level tools are available for focused refinement/debugging.
- **Promptable guardrails:** tool snippets and guidelines teach when to use each lane, when to prefer locations over snippets, and why results are advisory.
- **Context control:** detail modes, grouped summaries, compact command summaries, and TUI cards prevent raw CLI output from filling model and UI context.
- **Operational policy:** legacy sqry artifact checks, optional indexing, footer status, and runtime diagnostics are handled consistently instead of by ad hoc shell commands.
- **Backend independence:** the agent sees roles such as `syn` rather than being coupled to a specific CLI or future replacement.
- **Evaluation loop:** passive per-session usage logs let us tune prompts and defaults without adding an agent-facing analytics tool that would bias normal behavior.

Using backend CLIs directly can still be useful for debugging legacy lanes. The extension exists to make the common agent workflow safer, smaller, and more repeatable.

## Evaluation Notes

- 2026-04-28: In a promshim review session, an agent naturally read the code-intelligence skill, checked state, and used parallel Cymbal reference queries before reading files. This suggests the prompt surface is discoverable.
- 2026-04-28: Micro-action prompt tests on a tiny fixture and `~/code/external/pi-mono` showed agents naturally chose code-intel tools. They initially overused `includeDiagnostics:true`; guidance was tightened so diagnostics are for error/debug paths.
- 2026-04-28: Large-repo testing showed `detail:"locations"` was useful for routing to follow-up reads, reinforcing the default for references and impact maps.
- 2026-04-29: promshim and pi-processes review experiments showed Cymbal/sqry are too uneven to expose as general semantic-reference tools. The intended workflow narrowed to parent-run `impact_map`/`local_map` context prep plus optional syntax candidates before source reads or reviewer delegation.
- 2026-04-29: A `@vscode/tree-sitter-wasm` prototype on promshim parsed 267 Go files in under a second and produced correct current-source locations for `buildMatchedSeriesSQL` calls plus `NeedTags` field declarations, selector expressions, and keyed literals. This became the current-source Go evidence lane for `impact_map`.
- 2026-04-29: Tree-sitter became the default map/search engine. `impact_map`, `local_map`, and `syntax_search` no longer shell out to Cymbal/sqry/ast-grep for the normal path; those tools remain legacy low-level experiments only.

## Footer Status

The extension sets Pi extension status under the key `code-intel`:

- `ci:checking` while probing on session start.
- `ci syn:ok` style summaries after state checks. `syn` is the in-process Tree-sitter parser lane. Legacy `sem`/`nav` entries appear only when included in `backendOrder`.
- `ci:idx sem…` or `ci:idx nav…` while explicit legacy indexing runs.
- `ci:<backend> fail` or `ci:sqry blocked` when a legacy update fails or artifact policy blocks sqry.

Status words: `ok` means available/indexed or index-free, `noidx` means available but no legacy index, `stale` means stale, `missing` means the runtime/CLI is missing, `blocked` means sqry repo artifacts are not allowed, and `err` means the status probe failed.

Footer-framework can show it by adapting extension status `code-intel`, for example:

```text
/footerfx adapter code-intel status code-intel
/footerfx item code-intel line 2
/footerfx item code-intel zone right
```

Tool results use compact TUI cards: the default view shows a short status/count summary, while expanded rows show bounded file/caller/match details. The full JSON content is still returned to the agent.

This shows active legacy indexing when requested, but normal Tree-sitter parsing is on-demand and index-free.

## Inspecting Errors

The footer is intentionally compact. To inspect details, call:

```json
{"includeDiagnostics": true}
```

with `code_intel_state`. The diagnostic payload includes `runtimeDiagnostics` with recent auto-index and explicit update operations, the last error for the current repo, and the JSONL log path. Explicit `code_intel_update` calls also return per-backend command summaries directly.

Runtime diagnostics are best-effort: they are written to a small cache log and are meant for local debugging, not as proof of code impact.

## Usage Tracking

The extension passively records low-cardinality local usage metadata to help evaluate whether agents actually use the code-intelligence tools well. It does not register an agent-facing usage-inspection tool by default.

Default log directory:

```text
~/.cache/pi-code-intelligence/usage/
```

Each session writes its own `<session-id>.jsonl` file to avoid contention between concurrent Pi sessions. Set `PI_CODE_INTEL_USAGE_LOG` only when you explicitly want a single-file override for tests/debugging.

Recorded metadata includes tool names, timestamps, repo/cwd, sanitized parameter shapes, result counts/status, duration, coarse adjacent-tool categories such as `read`, `edit`, `bash:search`, or `bash:test`, and same-file `read`/`edit` follow-up events after successful guarded symbol replacements.

Not recorded by default: prompts, full tool outputs, file contents, raw shell commands, raw search queries, raw edit text, raw replacement source, or raw code-intel symbol/query/pattern values.

Use the log manually when evaluating this private extension, for example:

```bash
tail -n 40 ~/.cache/pi-code-intelligence/usage/*.jsonl
```

## Tools

### `code_intel_state`

Inspect Tree-sitter availability, config paths, legacy backend status, and sqry artifact policy.

Use this first when parser availability, missing legacy tools, or repo-local artifacts matter. It also refreshes the `code-intel` footer status. Omit `includeDiagnostics` for routine checks; use `includeDiagnostics: true` for footer errors, stale output, or failed legacy update commands.

### `code_intel_update`

Explicitly build or refresh legacy indexes. Normal Tree-sitter operation does not require this tool.

- `backend: "auto"` updates configured legacy indexed backends, if any.
- `backend: "tree-sitter"` reports that no index is required.
- `backend: "cymbal"` runs `cymbal index .` for legacy experiments.
- `backend: "ast-grep"` reports that no index is required; ast-grep is no longer used by default syntax search.
- `backend: "sqry"` refuses repo-local artifacts unless policy allows them.

During indexing, the `code-intel` footer status switches to `ci:idx <role>…` until the command finishes.

sqry artifact policy:

- `never` — never create repo-local artifacts.
- `ifIgnored` — allow when core sqry index directories are git-ignored.
- `always` — allow explicitly.

### `code_intel_symbol_context`

Return low-level Cymbal-backed definition/source/caller-candidate context for one symbol.

Use sparingly to explain one symbol that appears in an impact/local map. Caller rows are candidate callsites and can have imprecise names/locations; read current source before relying on them.

### `code_intel_symbol_source`

Resolve one symbol and return only its source span, relative file, start/end lines, source hash, and replacement preconditions.

Use only for focused source inspection after the surrounding impact/context is already understood. This is not a substitute for reading imports, adjacent declarations, callers, tests, or public-contract context when those matter.

### `code_intel_replace_symbol`

Experimentally replace exactly one symbol span using preconditions returned by `code_intel_symbol_source`.

Use only for narrow symbol-local edits where surrounding context is already understood or irrelevant. Do **not** use for signature changes, import changes, multi-symbol refactors, caller/test updates, generated files, or public contract changes whose callers were not inspected.

The tool:

1. re-resolves the current symbol,
2. verifies file/range/hash preconditions,
3. replaces only that source span under Pi's file mutation queue,
4. re-resolves the symbol after writing,
5. reverts the file if the replacement does not resolve as exactly the requested symbol span.

Success means "the guarded edit landed," not "the code is valid or complete." Run project-native validation and fall back to normal `read` + `edit` when imports, adjacent declarations, or callers matter.

Passive usage logs record sanitized follow-up signals for this experiment, including whether a same-file `read` or normal `edit` happens within a small window after a successful symbol replacement. Source text is not logged; hashes and line/byte counts are used instead.

### `code_intel_references`

Return low-level relationship candidate rows for one known symbol/type/file/package. Prefer `code_intel_impact_map` or `code_intel_local_map` first; use this only to refine a specific relationship question.

When `refs` returns no symbol-resolved rows, the tool runs bounded `cymbal search --text` fallback and marks rows as `kind: "text_fallback"`. This catches common field/property text cases, but those rows are not symbol-proven references.

Use `detail: "locations"` (default) when returned files are likely read targets. Use `detail: "snippets"` when small inline context is useful before deciding whether to read.

Relations:

- `refs` / `callers`
- `callees`
- `impact`
- `implementers`
- `implementedBy`
- `importers`

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

The tool combines Tree-sitter current-source map rows, optional selector syntax matches like `$X.RequiredTagLabels`, and bounded literal fallback, then returns suggested files to read next. Use standalone `rg` afterward for comments/docs, generated text beyond the returned cap, or unsupported-language gaps.

### `code_intel_impact_map`

Build the primary candidate read-next impact map from:

- explicit `symbols`
- `changedFiles` expanded through current-source Tree-sitter definitions
- optional `baseRef` using `git diff --name-only <baseRef> --`

The output groups roots and related caller/consumer candidates, with truncation and limitation metadata. Defaults are intentionally tighter than other nav queries: up to 20 root symbols after changed-file expansion and 25 related rows unless overridden. `detail: "locations"` is the default so impact maps route agents to files without duplicating source context. Use `detail: "snippets"` only when inline context helps triage without immediate reads. Returned impact rows omit absolute paths and cap context text; use `repoRoot` plus relative `file` paths for follow-up reads. The `summary` section reports related-file distribution (`relatedFileCount`, `topRelatedFiles`) so hidden breadth is visible without paging.

Impact maps add current-source Tree-sitter evidence rows such as `syntax_call`, `syntax_selector`, and `syntax_keyed_field`. These rows have correct file/line/column locations and enclosing function names where available, but they are syntax candidates, not type-resolved references.

When delegating review, run this in the parent and pass the roots, candidate files, reasons, coverage limits, and validation gaps to the reviewer. Builtin subagents may not have code-intel tools.

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

The extension never rewrites files through syntax search and does not shell out to ast-grep in the normal path.

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
  "backendOrder": ["tree-sitter"],
  "autoIndexOnSessionStart": true,
  "autoIndexBackends": [],
  "allowRepoArtifacts": "ifIgnored",
  "maxResults": 50,
  "queryTimeoutMs": 30000,
  "indexTimeoutMs": 300000,
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

Large repositories under `~/code/external/` are useful for manual smoke and usefulness checks, but not required for deterministic tests.
