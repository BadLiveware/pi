# Pi Code Intelligence

Pi Code Intelligence is a private local Pi extension for repository orientation and read-next context gathering. It gives Pi agents bounded, current-source maps of files, symbols, callers, tests, and syntax patterns that are likely worth inspecting before a non-trivial edit or review.

## How It Fits the Pi Workflow

Code-intel sits between the user's coding request and the agent's source reads:

1. The user asks Pi to inspect, edit, review, or understand code.
2. For non-trivial work, the agent asks code-intel for a bounded map of likely relevant files, symbols, tests, or patterns.
3. The agent reads current source from that map instead of relying on broad search output or memory.
4. The agent implements, reviews, or explains the change with project-native validation where needed.

The extension supplies navigation evidence, not final answers. It is most useful when a small amount of structured context can prevent missed callers, missed tests, noisy searches, or unnecessary full-file reads.

## What It Improves

- Repository orientation in large or unfamiliar codebases.
- Review/edit prep with compact caller, consumer, test, and related-file candidates.
- Concept routing without dumping raw global search output.
- Test discovery for source files, symbols, and domain terms.
- Targeted symbol reads and narrow symbol-scoped mutations.
- Evidence discipline: syntax matches remain syntax evidence, not semantic proof.

## What It Is Not

Code Intelligence is not a compiler, language server replacement, full semantic index, linter, typechecker, test runner, or bug detector. It does not prove a change is safe.

Its output means: "these are useful places to inspect next." Findings, edits, and completion claims still need current source reads and project-native validation.

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
| Post-edit follow-up | Changed symbols, likely callers/tests, and optional touched-file diagnostics after edits. |
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
| Optional reference confirmation | Bounded exact-reference evidence for selected Go, TypeScript/JavaScript, or clangd-backed C/C++ roots. | Whole-program proof or a replacement for reading source. |
| Touched-file diagnostics | Current TypeScript/JavaScript diagnostics for files involved in the task. | Proof that diagnostics are new unless a baseline says so. |

Tool results are a queue of places to inspect, not findings to report directly.

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

## Engines and Coverage

| Engine | Used for | Artifact behavior |
| --- | --- | --- |
| Tree-sitter WASM | Current-source definitions, file outlines, capped repo file-tier declarations, call candidates, selector/member fields, keyed/object-literal fields, local maps, and syntax search. Impact maps currently route Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++ source files. Rust routing is syntax-only; C/C++ changed-file routing is scoped for large-repo safety unless explicit paths broaden it. | No index. |
| `rg` | Bounded literal fallback in local maps and follow-up searches. | No index. |
| Optional LSP/reference providers | Bounded exact-reference confirmation for Go (`gopls`), TypeScript/JavaScript, and C/C++ (`clangd` with `compile_commands.json`). | Opt-in per map run. |

`code_intel_state` can report availability for `gopls`, Rust Analyzer, TypeScript, and clangd, but availability is not evidence that reference confirmation was run. Cymbal, sqry, and ast-grep are intentionally not part of the normal extension path.

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

Impact routing currently supports Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++ source files. When changed files are non-source or outside the supported set, coverage fields explain what was unsupported so fallback can be deliberate.

For high-value exactness checks, the tool supports bounded confirmation with `gopls`, TypeScript/JavaScript language services, or clangd. Missing or broken confirmation tooling should not affect the default Tree-sitter map.

### `code_intel_local_map`

Builds a scoped local read-next map from central anchors plus related names. This replaces many ad hoc compound context-gathering searches over a known subsystem.

The tool combines Tree-sitter current-source map rows, optional selector syntax matches, and bounded `rg` literal fallback, then returns suggested files to read next.

### `code_intel_test_map`

Returns evidence-ranked test candidates for a scoped file, symbol, or domain name.

It uses bounded test-root discovery, path/name similarity, literal matches, and optional reference confirmation for source-code tests. It can find non-code tests such as SQL fixtures as well as source-code tests. Generated/cache/log artifacts are ignored by default, and generic path-only terms are downranked.

The result means “likely tests to inspect or run,” not proof of coverage.

### `code_intel_syntax_search`

Runs a read-only in-process Tree-sitter search for an explicit pattern.

Supported convenience patterns include calls such as `authenticate($A)`, selectors/properties such as `$OBJ.NeedTags`, keyed fields/object-literal properties such as `NeedTags: $VALUE`, wrapper patterns containing those shapes, and raw Tree-sitter S-expression queries with captures.

The extension never rewrites files through syntax search.

### `code_intel_read_symbol`

Reads one declaration by locator target or explicit selector.

This is source mode: compact content includes the returned source segment. Function-like declarations return the full function/method/constructor body by default. Optional one-hop same-file referenced definitions can include constants, variables, and types; called functions/helpers are deliberately not recursively expanded.

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

With diagnostics enabled, it can merge supplied diagnostics with current TypeScript/JavaScript touched-file diagnostics. These diagnostics are not baseline-compared.

### `code_intel_state`

Inspects Tree-sitter, `rg`, optional language-server availability, config paths, loaded config, limitations, footer status, and optional diagnostics.

Routine state checks normally omit diagnostics; diagnostics are for parser availability, missing `rg`, footer errors, or failed probe debugging.

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

The extension is optimized for read-next routing, not replacing source reads or project validation.

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
node --experimental-strip-types --test private/code-intelligence/index.test.ts
```

A small read-next quality fixture is available as a dogfood eval:

```bash
cd agent/extensions
npm run eval:code-intel
```

Large repositories under `~/code/external/` or active local projects are useful for manual smoke and usefulness checks, but not required for deterministic tests.
