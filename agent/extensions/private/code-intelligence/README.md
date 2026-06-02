# Pi Code Intelligence

Pi Code Intelligence is a private local Pi extension for repository orientation, read-next context gathering, and targeted symbol operations. It gives Pi agents bounded, current-source maps of files, symbols, callers, tests, and syntax patterns, plus narrow helpers for reading or mutating resolved declarations.

## How It Fits the Pi Workflow

Code-intel covers two adjacent parts of the Pi workflow: context routing before source reads, and symbol-targeted operations after a declaration has been resolved.

1. The user asks Pi to inspect, edit, review, or understand code.
2. For non-trivial work, the agent asks code-intel for a bounded map of likely relevant files, symbols, tests, or patterns.
3. The agent reads current source from that map instead of relying on broad search output or memory.
4. When the task needs a focused declaration read or edit, symbol tools can use resolved targets and hash/text safety checks instead of reconstructed line numbers.
5. The agent implements, reviews, or explains the change with project-native validation where needed.

The mapping tools supply navigation evidence for source reads and validation. The symbol tools supply focused source reads and anchored mutations. For broad repeated changes, use overview/route/impact/local/syntax tools to discover and verify targets, then choose the right edit path: symbol-aware mutation, generic `edit`, or a project codemod. The extension is most useful when structured context or resolved declaration targets can prevent missed callers, missed tests, noisy searches, unnecessary full-file reads, or brittle line-number edits.

## What It Improves

- Repository orientation in large or unfamiliar codebases.
- Review/edit prep with compact caller, consumer, test, and related-file candidates.
- Concept routing without dumping raw global search output.
- Test discovery for source files, symbols, and domain terms.
- Targeted symbol reads and narrow symbol-scoped mutations.
- Evidence discipline: syntax matches remain syntax evidence, not semantic proof.

## Boundaries and Validation

Use Code Intelligence for bounded current-source routing, file outlines, symbol reads, and anchored mutations. Pair it with compilers, language servers, linters, typecheckers, test runners, benchmarks, or manual checks when those are the validation evidence the task needs.

For mapping and search tools, output means: "these are useful places to inspect next." For mutation tools, output means that an anchored edit was applied. Findings, broader edits, and completion claims still need current source reads and project-native validation.

## Where It Helps

| Workflow need | What code-intel contributes |
| --- | --- |
| Repository orientation | Directory/file shape, dominant languages, and capped declarations for scoped subtrees. |
| Concept or API routing | Likely implementation files for terms such as feature names, API names, symbols, or domain strings. |
| Diff review or edit prep | Likely callers, consumers, tests, and related files from changed files, root symbols, or a git base ref. |
| Scoped subsystem exploration | Local maps from known anchors plus related fields, types, names, or APIs. |
| Test selection | Ranked test candidates for a source file, symbol, or domain term. |
| Pattern investigation | Explicit Tree-sitter syntax search for calls, selectors, keyed fields, object properties, or raw queries. |
| Targeted symbol work | Complete declaration reads plus safe replace/insert operations around resolved symbol anchors. |
| Post-edit follow-up | Changed symbols, likely callers/tests, optional touched-file diagnostics, and automatic idle surfacing for current touched-file diagnostics after edits. |
| Extension troubleshooting | Parser, `rg`, optional LSP, config, footer, and runtime diagnostic state. |

## Tool Surface

The extension exposes these tools to Pi agents:

| Tool | Purpose |
| --- | --- |
| `code_intel_repo_overview` | Repository or subtree orientation: directory/file shape and, for scoped file-tier runs, capped declarations. |
| `code_intel_file_outline` | One-file structure: imports/includes and declarations before reading the full source. |
| `code_intel_repo_route` | Concept routing: likely implementation files for API, feature, symbol, or domain terms. |
| `code_intel_impact_map` | Main review/edit prep: likely callers, consumers, tests, and related files from changed files, root symbols, or a git base ref. |
| `code_intel_local_map` | Scoped subsystem mapping from central anchors plus related names, fields, types, or APIs. |
| `code_intel_test_map` | Likely tests for a source file, symbol, or domain term. |
| `code_intel_syntax_search` | Current-source Tree-sitter searches for explicit API or syntax shapes. |
| `code_intel_read_symbol` | Complete source for one resolved declaration/body from a locator target or explicit selector. |
| `code_intel_replace_symbol` | Narrow mutation: replace one resolved declaration after checking `oldText` or `oldHash`. |
| `code_intel_insert_relative` | Narrow mutation: insert text before or after a resolved declaration anchor. |
| `code_intel_post_edit_map` | Post-edit follow-up: changed symbols, likely callers/tests, and optional touched-file diagnostics. |
| `code_intel_state` | Extension health: Tree-sitter, `rg`, optional LSP availability, config, footer status, and diagnostics. |

## Evidence Model

Code-intel output is deliberately conservative about what it claims.

| Evidence source | What it can support | What it cannot support by itself |
| --- | --- | --- |
| Tree-sitter | Current-source syntax facts: declarations, calls, selectors, fields, import/include structure, and explicit syntax matches. | Type-resolved semantics, complete reference graphs, or safety claims. |
| `rg` fallback | Literal text evidence in source, comments, docs, fixtures, generated files, or unsupported-language gaps. | Symbol/reference proof. |
| Optional reference confirmation | Bounded exact-reference evidence for selected Go, TypeScript/JavaScript, Rust, Python, clangd-backed C/C++, or C# roots. | Whole-program proof or a replacement for reading source. |
| Touched-file diagnostics | Current diagnostics for touched files when a bounded provider applies: TypeScript/JavaScript language services, `gopls check`, Rust Analyzer, Python providers, `clangd`, `csharp-ls`, ShellCheck, `zsh -n`, or `markdownlint-cli2`. | Proof that diagnostics are new unless a baseline says so. |

Mapping and search results are a queue of places to inspect, not findings to report directly. Mutation results confirm a scoped file change, not broader correctness.

## Workflow Guardrails

The expected Pi workflow keeps these boundaries:

- Current source is read before claims are made from code-intel output.
- Project-native tests, typechecks, benchmarks, linters, or manual checks still validate behavior when they match the risk.
- Result sets stay bounded instead of scanning the whole repo by default.
- Location output is preferred when files will be read next; snippets are for quick triage.
- Complete symbol segments are not reread without a freshness, truncation, ambiguity, or edit-context reason.
- Empty or failed impact maps require checking coverage and limitation fields before falling back.
- Standalone search remains useful for comments/docs/generated text, literal fallback beyond caps, and unsupported-language gaps.
- Review subagents receive code-intel context from the parent when they do not have the tools themselves.
- At agent quiescence, recent touched files with applicable diagnostics providers can surface current diagnostics as a safety net.

## Engines and Coverage

| Engine | Used for | Artifact behavior |
| --- | --- | --- |
| Tree-sitter WASM / scanners | Current-source definitions, file outlines, capped repo file-tier declarations, call candidates, selector/member fields, keyed/object-literal fields, Markdown document structure, local maps, and syntax search where supported. | No index. |
| `rg` | Bounded literal fallback in local maps and follow-up searches. | No index. |
| Optional reference providers | Bounded exact-reference confirmation for Go (`gopls`), TypeScript/JavaScript, Rust (`rust-analyzer`), Python (`pyrefly`), C/C++ (`clangd` with `compile_commands.json`), and C# (`csharp-ls`). | Opt-in per map run. |
| Optional diagnostics providers | Bounded current touched-file diagnostics from TypeScript/JavaScript, Go (`gopls check`), Rust Analyzer, Python (Pyrefly, ty, basedpyright/pyright), C/C++ (`clangd`), C# (`csharp-ls`), ShellCheck, `zsh -n`, and `markdownlint-cli2` when those tools apply and are available. | Not baseline-compared; not a project-wide validation run. |

### Language coverage

| Language | Structure and routing | Exact refs | Diagnostics | Key limits |
| --- | --- | --- | --- | --- |
| Go | Strong outline/read/mutate, imports, syntax impact, local map, and test map. | `gopls` opt-in. | `gopls check` for touched `.go` files. | Default maps remain syntax evidence until confirmation is requested. |
| TypeScript / TSX / JavaScript | Strong outline/read/mutate, syntax search, impact, local map, and test map. | TypeScript language service opt-in. | TypeScript language-service diagnostics for touched TS/JS files. | Diagnostics are current, not baseline-compared. |
| Rust | Outline/read/mutate and syntax-only impact/local/test routing. | Rust Analyzer opt-in. | Rust Analyzer publishDiagnostics for touched `.rs` files. | Default routing is syntax evidence and does not require Rust Analyzer. |
| Python | Python-specific outline/read/mutate plus syntax impact/local/test routing. | Pyrefly opt-in. | Pyrefly preferred, then ty, basedpyright, and pyright for touched `.py` files. | Default routing is syntax evidence; diagnostics are current and not baseline-compared. |
| C/C++ | C/C++ outline/read/mutate, scoped impact/local/test routing, includes, templates, methods, fields, and macros. | `clangd` opt-in with `compile_commands.json`. | `clangd` publishDiagnostics for touched C/C++ files with `compile_commands.json`. | Compile database quality controls provider usefulness. |
| C# | C# outline/read/mutate for common declarations plus syntax impact/local/test routing. | `csharp-ls` opt-in. | `csharp-ls` publishDiagnostics for touched `.cs` files. | Default routing is syntax evidence and does not require `csharp-ls`. |
| Bash | Shell outline/read/mutate for tested ranges plus syntax impact/local/test routing. | None. | ShellCheck for touched `.sh`/`.bash` files. | Command routing cannot prove whether a command is local or external without source reads. |
| zsh | zsh-labeled shell outline/read/mutate plus syntax impact/local/test routing. | None. | `zsh -n` for touched `.zsh` files. | Uses the Bash Tree-sitter grammar, so zsh-specific syntax can parse imperfectly. |
| Markdown | Frontmatter, headings/sections, links, reference definitions, code fences, section reads, and section-scoped mutations. Local/test maps use document structure and literals; impact reports doc changes instead of code impact. | None. | `markdownlint-cli2` for touched Markdown files. | Document structure support, not code semantics or link-checking by default. |

`code_intel_state` reports the registry-backed language capability summary and optional provider availability. Availability is not evidence that reference confirmation or diagnostics were run, and missing optional providers do not break default Tree-sitter/scanner maps. Cymbal, sqry, and ast-grep are intentionally not part of the normal extension path.

## Tool Details

### `code_intel_repo_overview`

Builds a large-repo-safe orientation map.

The broad `shape` tier summarizes directories, file counts, source/test/doc/config buckets, dominant languages, exclusions, caps, and truncation without parsing declarations. The scoped `files` tier lists files and capped top-level declarations per file.

The output is filesystem and Tree-sitter syntax evidence for navigation. It does not infer semantic roles such as entrypoints or architectures.

### `code_intel_file_outline`

Parses one source file and returns imports/includes plus language-native declarations with line ranges.

Declaration rows are locator-mode: compact output shows a short stable reference plus a read hint, while structured details include the full `symbolTarget` and `readHint`. The next step is either one precise source read or a `code_intel_read_symbol` call with the target metadata. Outlines do not include declaration bodies unless snippet detail is requested.

### `code_intel_repo_route`

Ranks likely files for concept, API, feature, or function terms using bounded path and literal evidence.

Route results are file candidates, not semantic proof. Implementation claims still need outline/source inspection of returned files.

### `code_intel_impact_map`

Builds the primary candidate read-next impact map from explicit symbols, changed files, or a git base ref.

The output groups root symbols and related caller/consumer candidates, with truncation and limitation metadata. Defaults are bounded but close to normal search habits: up to 20 root symbols after changed-file expansion and 125 location rows unless overridden.

Impact routing currently supports registry-backed code impact for Go, TypeScript/TSX, JavaScript, Rust, Python, C/C++, C#, Bash, and zsh. Markdown changed files are reported as documentation changes instead of code impact. When changed files are non-source or outside the supported set, coverage fields explain what was unsupported so fallback can be deliberate.

For high-value exactness checks, the tool supports bounded confirmation with `gopls`, TypeScript/JavaScript language services, Rust Analyzer, or clangd. Missing or broken confirmation tooling should not affect the default Tree-sitter map.

### `code_intel_local_map`

Builds a scoped local read-next map from central anchors plus related names. This replaces many ad hoc compound context-gathering searches over a known subsystem.

The tool combines Tree-sitter current-source map rows, optional selector syntax matches, Markdown heading/link/code-fence matches, and bounded `rg` literal fallback, then returns suggested files to read next.

### `code_intel_test_map`

Returns evidence-ranked test candidates for a scoped file, symbol, or domain name.

It uses bounded test-root discovery, path/name similarity, literal matches, and optional reference confirmation for source-code tests. It can find non-code tests such as SQL fixtures as well as source-code tests. Generated/cache/log artifacts are ignored by default, and generic path-only terms are downranked.

Use the result as a ranked shortlist of likely tests to inspect or run, then confirm coverage through the test source or validation command.

### `code_intel_syntax_search`

Runs a read-only in-process Tree-sitter search for an explicit pattern.

Supported convenience patterns include calls such as `authenticate($A)`, selectors/properties such as `$OBJ.NeedTags`, keyed fields/object-literal properties such as `NeedTags: $VALUE`, wrapper patterns containing those shapes, and raw Tree-sitter S-expression queries with captures. Markdown uses the local-map document scanner rather than Tree-sitter syntax search.

The extension never rewrites files through syntax search.

### `code_intel_read_symbol`

Reads one declaration by locator target or explicit selector.

This is source mode: compact content includes the returned source segment. Function-like declarations return the full function/method/constructor body by default; Markdown targets return the selected section, frontmatter block, or code fence. Optional one-hop same-file referenced definitions can include constants, variables, and types; called functions/helpers are deliberately not recursively expanded.

Source segment headers include an `oldHash` for token-light safety checks with symbol-aware mutation tools.

### `code_intel_replace_symbol`

Replaces the current text of one resolved declaration.

This is a mutation tool. It resolves a locator target or explicit selector freshly, then requires `oldText` or `oldHash` before writing. If both are supplied, both must match.

### `code_intel_insert_relative`

Inserts text before or after a resolved declaration anchor.

The tool accepts the same symbol target shape from outline or read-symbol output, or an explicit selector such as path plus symbol. It inserts at the fresh symbol boundary, which makes it safer for structural insertions around known declarations than reconstructing line numbers by hand.

### `code_intel_post_edit_map`

Builds a read-only follow-up map after edits or writes.

It returns locator-mode changed symbols, likely caller/consumer rows, likely test candidates, and optional diagnostic-focused declaration targets. When changed files are omitted, it can use session-tracked files from recent edit/write/code-intel mutation calls. It does not run tests, apply fixes, or mutate files.

With diagnostics enabled, it can merge supplied diagnostics with current touched-file diagnostics from bounded providers such as TypeScript/JavaScript language services, `gopls check`, Rust Analyzer, Python providers (Pyrefly, ty, basedpyright/pyright), `clangd`, `csharp-ls`, ShellCheck, `zsh -n`, and `markdownlint-cli2`. These diagnostics are not baseline-compared.

If recent edits touched files with an applicable diagnostics provider, the extension can automatically surface current touched-file diagnostics when the agent becomes idle. That automatic message is a safety net, not a replacement for project-native validation.

### `code_intel_state`

Inspects Tree-sitter, `rg`, optional language-server availability, config paths, loaded config, limitations, footer status, and optional diagnostics.

Routine state checks normally omit diagnostics; diagnostics are for parser availability, missing `rg`, footer errors, or failed probe debugging.

## Standalone CLI and MCP Server

The same code-intelligence tool registry can run outside Pi for use from other agent harnesses such as Claude Code.

```bash
cd agent/extensions/private/code-intelligence
npm run build
./dist/standalone/cli.js list
./dist/standalone/cli.js call code_intel_impact_map --json '{"changedFiles":["src/index.ts"]}'
./dist/standalone/cli.js mcp
./dist/standalone/cli.js mcp --cwd /path/to/repo  # optional pinned repo launch
```

The standalone path exposes read-only tools by default: state, overview, outline, route, test-map, impact-map, local-map, syntax-search, read-symbol, and post-edit-map. Symbol mutation tools are opt-in with `--enable-mutations`; enable them when a workflow should use code-intel's parsed-source edit path for hash/text-verified declaration replacements or anchor-relative insertions.

Standalone config is loaded in this order: Pi user config, standalone user config, project config, explicit `--config` path, then inline overrides from code. The standalone user config path is `~/.config/code-intelligence/config.json` unless `XDG_CONFIG_HOME` changes it. Standalone path inputs default to `--path-base auto`, which accepts repo-root-relative paths or cwd-relative paths; omit `--cwd` for project-scoped Claude Code setup, and use `--cwd` only for a deliberately pinned server launched from outside the target repo. Use `--path-base repo` or `--path-base cwd` to force one interpretation. In Claude Code, pass edited files explicitly to `code_intel_post_edit_map` with `changedFiles` or `baseRef`; Pi-only touched-file session tracking is not available through MCP.

The workspace package declares a `code-intel` bin at `dist/standalone/cli.js`; run `npm run build` before linking, packing, or using the short installed command. The TypeScript entrypoint can still be invoked with `node --experimental-strip-types` for source-only debugging, but normal CLI/MCP use should run the built bin. For Claude Code configuration and smoke-test commands, see [docs/claude-code-mcp.md](docs/claude-code-mcp.md).

## Configuration

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

## Footer Status and TUI Output

The extension sets Pi extension status under the key `code-intel`:

- `ci:checking` while probing on session start.
- `ci syn:ok · rg:ok` style summaries after state checks. `syn` is the in-process Tree-sitter parser lane and `rg` is the literal fallback lane.
- `ci:error` if status probing fails.

Status words: `ok` means available, `missing` means the fallback binary is missing, and `err` means the status probe failed.

Footer-framework can show it by adapting extension status `code-intel`:

```text
/footerfx adapter code-intel status code-intel
/footerfx item code-intel line 2
/footerfx item code-intel zone right
```

Tool results use compact TUI cards. The default view shows a short status/count summary, while expanded rows show bounded file/caller/match details. Agent-visible tool content is compact text by default; full structured payloads remain available in tool details for programmatic use and tests.

## Diagnostics and Troubleshooting

For parser, fallback, LSP, config, footer, or runtime problems, `code_intel_state` can include diagnostics. The diagnostic payload includes config diagnostics, backend probe diagnostics, recent runtime operations, and the JSONL log path.

Runtime diagnostics are best-effort. They are written to a small cache log and are meant for local debugging, not as proof of code impact.

## Usage Tracking

The extension passively records low-cardinality local usage metadata to help evaluate whether code-intelligence tools are used well in real sessions. It does not register a usage-inspection tool by default.

Default log directory:

```text
~/.cache/pi-code-intelligence/usage/
```

Each session writes its own `<session-id>.jsonl` file to avoid contention between concurrent Pi sessions. Set `PI_CODE_INTEL_USAGE_LOG` only when you explicitly want a single-file override for tests/debugging.

Recorded metadata includes tool names, timestamps, stable per-call invocation ids, repo/cwd, sanitized parameter shapes, returned-file and returned-segment counts/ranks, result counts/status, truncation/max-result hints, duration, and coarse adjacent-tool categories such as `read`, `edit`, `write`, `bash:search`, or `bash:test`.

Follow-up records can indicate whether a read/edit/write matched a returned file or source segment and its rank, whether a same-range read likely duplicated a complete segment, or whether a later search/test looked like compensatory search or validation.

Not recorded by default: prompts, full tool outputs, file contents, raw shell commands, raw search queries, raw edit text, or raw code-intel symbol/query/pattern values.

Manual inspection example:

```bash
tail -n 40 ~/.cache/pi-code-intelligence/usage/*.jsonl
```

## Design Rationale

The extension is optimized for read-next routing and targeted symbol operations, not replacing source reads or project validation.

| Decision | Rationale |
| --- | --- |
| Tree-sitter first (`syn`) | Current-source syntax maps provide useful read-next evidence without stale indexes, shelling out, or repo-local artifacts. |
| Keep `rg` as literal fallback | Text is still useful for comments, docs, generated files, and unsupported-language gaps, but should be labeled separately from syntax evidence. |
| Small tool surface | The extension is about read-next routing plus narrow symbol-targeted mutations, not a general semantic database or broad codemod API. |
| Default broad map tools to location detail | Returned files are usually read or edited next, so inline snippets would duplicate source context. Snippets are best for triage. |
| Locator mode vs source mode | Locator tools return target/read-hint data without source bodies; `code_intel_read_symbol` returns complete bounded source segments. The workflow avoids doing both for the same range unless freshness, truncation, or ambiguity requires it. |
| Summaries before pagination | File counts and top files show distribution and hidden breadth without encouraging agents to browse pages mechanically. |
| Compact TUI cards, structured details | The UI stays readable while structured payloads remain available for reasoning and tests. |
| Passive usage logs, no usage-inspection tool | Natural adoption can be evaluated without adding a tool that changes normal behavior. |

## Source Layout and Extension Work

Code-intelligence is organized by vertical slices. `index.ts` is lifecycle wiring only: resource discovery, passive usage hooks, session-start footer refresh, and tool registration calls.

- `src/slices/<slice>/tool.ts` owns tool schema, prompt guidance, execution wiring, and custom TUI rendering for that slice.
- `src/slices/<slice>/run.ts` owns the slice behavior when implementation is slice-specific.
- `src/slices/<slice>/compact.ts` owns the compact agent-visible text renderer for that slice; `src/compact-output.ts` is only a dispatcher.
- `src/slices/<slice>/types.ts` owns slice-specific parameter types; `src/types.ts` re-exports shared and slice types for compatibility with existing imports.
- `src/core/` contains small shared primitives for compact rendering, tool-card rendering, and cross-slice types.
- Shared parser/range/repo/config helpers stay outside slices and should remain behavior-neutral. If `tree-sitter.ts` or another shared engine keeps growing, split it by parser concern before adding more feature-specific logic to it.

When adding a tool, start with a slice folder and keep the tool contract, run behavior, compact renderer, and focused tests close together. Avoid adding new tool behavior to `index.ts`, `compact-output.ts`, or `types.ts` beyond dispatcher/re-export wiring.

## Evaluation Notes

- 2026-04-28: Initial prompt tests showed code-intel tools were selected naturally, but detailed diagnostics were overused. Guidance now keeps diagnostics for error/debug paths.
- 2026-04-29: Cymbal/sqry/ast-grep were evaluated and found useful for exploration but too uneven or too much operational surface for the default read-next product boundary.
- 2026-04-29: A `@vscode/tree-sitter-wasm` prototype on promshim produced correct current-source locations for `buildMatchedSeriesSQL` calls plus `NeedTags` field declarations, selector expressions, and keyed literals.
- 2026-04-29: Tree-sitter became the default map/search engine. `impact_map`, `local_map`, and `syntax_search` no longer shell out to Cymbal/sqry/ast-grep.
- 2026-04-29: The extension was simplified to Tree-sitter plus bounded `rg` literal fallback; low-level Cymbal/sqry symbol/reference/edit tools were removed.

## Validation

Focused extension tests use small temp repos for determinism:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/code-intelligence/test/index.test.ts
```

A small read-next quality fixture is available as a dogfood eval:

```bash
cd agent/extensions
npm run eval:code-intel
```

Large repositories under `~/code/external/` or active local projects are useful for manual smoke and usefulness checks, but not required for deterministic tests.
