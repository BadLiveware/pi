---
name: code-intelligence
description: "Use when orienting in a large repo or preparing a bounded read-next map for non-trivial code review/edits: repo shape, file outlines, tests, changed files, shared symbols, handlers, config/schema/protocol code, or scoped subsystem mapping."
---

# Code Intelligence

Use `code_intel_*` tools whenever they fit the code task. They are owned dogfood surfaces: prefer them over ad hoc broad searches, line-number reconstruction, or repeated whole-file reads when they can route, read, or mutate more directly. If a result is noisy or incomplete, continue with the best fallback and surface that feedback instead of avoiding the tool next time.

## Core Workflow

1. In a large unfamiliar repo, start with `code_intel_repo_overview` tier `shape`, then scope to tier `files`, then use `code_intel_file_outline` for individual large files.
2. If you have concept/API terms but no anchor file, use `code_intel_repo_route` with scoped paths before falling back to global `rg`.
3. For a concrete edit/review, start from the task boundary: diff, changed files, base ref, or a small set of root symbols.
4. Run `code_intel_impact_map` for review/edit impact context, or `code_intel_local_map` for a scoped subsystem with anchors plus related names.
5. Use `code_intel_test_map` when you need likely tests to inspect or run for a file/symbol/name.
6. Use `code_intel_syntax_search` for explicit current-source shapes the map cannot express, then read or edit the matched targets with the normal/source-aware tools.
7. For locator-mode outputs, use `readHint` for one precise generic read or pass `symbolTarget` to `code_intel_read_symbol` when you need a complete declaration body.
8. Let a complete `code_intel_read_symbol` segment count as the source read and proceed from it; reread only when freshness, truncation, ambiguity, or edit context requires more.
9. Prefer `code_intel_replace_symbol` for declaration-sized replacements once you have `oldText` or `oldHash` safety evidence. Prefer `code_intel_insert_relative` when inserting before/after a resolved symbol anchor is clearer than manual line edits.
10. After editing/writing, use `code_intel_post_edit_map` when you need changed-symbol, caller/test, or touched-code diagnostic follow-up context. Omit `changedFiles` to use session-tracked edit/write/code-intel mutation files when available.
11. Run project-native validation when behavior, public contracts, tests, or generated outputs matter.

## Delegating Review

Builtin subagents may not have code-intel tools. Do not assume a reviewer subagent can call them.

Before delegating review, the parent should usually:

1. Inspect the diff or changed files.
2. Run `code_intel_impact_map` with `changedFiles`, `baseRef`, or root `symbols`.
3. Add any scoped `code_intel_syntax_search` results for known risky syntax patterns.
4. Pass the candidate files/reasons and limitations in the reviewer prompt.

Prefer a custom code-intel-aware reviewer when review quality depends on these maps and the agent is configured with the relevant tools.

## Source Layout for Code-intel Work

Reusable tool behavior lives in `/home/fl/code/personal/code-intel/`, not in the Pi extension. Edit that standalone package first for schemas, prompt guidance, compact output, parser/provider behavior, CLI/MCP behavior, and reusable tests. The package exposes Pi-needed reusable APIs through `code-intel/pi-integration`.

When editing the Pi extension, keep it as the adapter layer:

- `index.ts` wires lifecycle hooks and slice registrations only.
- `src/pi-tool-adapter.ts` adapts package `CodeIntelToolSpec` objects to Pi `registerTool` calls.
- `src/slices/<slice>/tool.ts` owns Pi registration and custom TUI result rendering around package specs.
- `src/slices/post-edit-map/touched-files.ts`, `src/slices/diagnostic-surface/hook.ts`, `src/slices/state/**`, and `src/slices/usage/**` own Pi-specific session, footer, diagnostic-surfacing, and usage behavior.
- Do not reintroduce mirrored common implementation files under the Pi extension.

## Tool Selection

- `code_intel_repo_overview`: orientation tool. Use tier `shape` for broad directory counts/languages without parsing declarations; use tier `files` only for explicit subtrees to list files plus capped declaration names.
- `code_intel_file_outline`: single-file orientation. Returns imports/includes and language-native declarations with locator-mode `symbolTarget`/`readHint` fields before reading a large file.
- `code_intel_test_map`: related-test candidates. Uses bounded test-root discovery, path/name evidence, and literal matches; pass file paths plus symbols/domain names for better non-code test results. It filters cache/log artifacts and avoids generic path-only noise where possible.
- `code_intel_repo_route`: concept routing. Ranks likely implementation files for concept/API/function terms using bounded path and literal evidence without dumping raw search output. Scope paths in large repos, then outline/read returned files.
- `code_intel_impact_map`: primary edit/review impact tool. Builds a Tree-sitter current-source candidate read-next map from changed files, root symbols, or a base ref. Impact routing follows the language registry for Go, TypeScript/TSX, JavaScript, Rust, Python, C/C++, C#, Bash, and zsh; Markdown changed files are reported under `coverage.docFiles` rather than treated as code impact. Shell and zsh routing is syntax-only; C/C++ changed-file routing is scoped for large-repo safety unless explicit paths broaden it. Rows include evidence such as `syntax_call`, `syntax_selector`, and `syntax_keyed_field`. Use `confirmReferences` only for bounded, opt-in Go, TypeScript/JavaScript, Rust Analyzer, Pyrefly Python, clangd-backed C/C++, or csharp-ls C# exact-reference confirmation when exactness materially reduces risk; C/C++ also needs a usable `compile_commands.json`.
- `code_intel_local_map`: scoped subsystem map. Uses Tree-sitter current-source rows plus bounded `rg` literal fallback when you have anchors plus related fields/types/API names and want suggested local files to read. Language aliases such as `c#`, `c++`, `py`, `zsh`, and `md` are normalized; Markdown uses heading/link/code-fence routing plus literal fallback instead of Tree-sitter syntax search.
- `code_intel_syntax_search`: explicit in-process Tree-sitter candidate search. Use supported patterns such as `foo($A)`, `$OBJ.Field`, `Field: $VALUE`, wrapper patterns containing those shapes, or raw Tree-sitter queries with captures.
- `code_intel_read_symbol`: source-mode targeted declaration read. Prefer passing a `symbolTarget`; function-like targets return the full body, while Markdown targets return a section, frontmatter block, or code fence. Optional referenced context is same-file, one-hop, and limited to constants, vars, and types; called functions/helpers are deferred. Segment headers include `hash=<oldHash>` for token-light mutation safety.
- `code_intel_replace_symbol`: mutation tool for replacing one resolved declaration. Requires `oldText` or `oldHash`; prefer `oldHash` from `code_intel_read_symbol` when avoiding large oldText echo is useful.
- `code_intel_insert_relative`: mutation tool for inserting text before/after a resolved declaration anchor. It can consume `symbolTarget` from either `code_intel_file_outline` or `code_intel_read_symbol`.
- `code_intel_post_edit_map`: read-only follow-up map after edits/writes. Returns changed-symbol locators, likely caller/test candidates, session-tracked touched files when `changedFiles` is omitted, and optional diagnostic-focused targets. With `includeDiagnostics:true`, it collects current touched-file diagnostics from applicable bounded providers such as TypeScript/JavaScript language services, `gopls check`, Rust Analyzer, Python providers (Pyrefly, ty, basedpyright/pyright), `clangd`, `csharp-ls`, ShellCheck, `zsh -n`, and `markdownlint-cli2`, then merges any supplied diagnostics. It does not run tests or fix code.
- `code_intel_state`: inspect Tree-sitter, `rg`, and optional LSP availability, config, footer status, and diagnostics when that matters.

## Usage Notes

- Use repo overview and file outlines for deterministic structure and syntax facts: paths, filenames, imports/includes, declarations, line ranges, and locator targets.
- Use Tree-sitter rows as the first read-next queue. Read the suggested current source before making review findings or compatibility claims.
- Broad code-intel scans respect git ignore rules by default. Use explicit ignored paths or `includeIgnored:true` when generated outputs such as source-generator `.g.cs` files are the evidence you need.
- Use `rg` fallback rows for literal text in source, comments, docs, fixtures, generated files, or unsupported-language gaps.
- Use `code_intel_state` when parser, `rg`, config, footer, or optional provider availability affects the next move.
- Use `code_intel_post_edit_map` diagnostics as current touched-file feedback. Fix or disclose them according to the task's validation needs.
- Use `referenceConfirmation` rows from opt-in providers such as `gopls`, TypeScript, Rust Analyzer, Pyrefly, clangd, or csharp-ls when exact-reference confirmation materially helps. For C# impact maps, `confirmReferences:"csharp-ls"` promotes exact reference rows into `related` before syntax-only candidates.
- Pair code-intel with project-native tests, typechecks, linters, benchmarks, or language tools when those are the right validation evidence for the change.
- For Markdown, use local-map document matching for headings, links, and code fences; inspect section text before making document claims.
- For zsh, use the zsh-labeled shell support backed by the Bash grammar, then inspect source when zsh-specific syntax could affect behavior.
- For broad repeated edits, use overview/route/impact/local/syntax tools to discover and verify targets, then apply the right edit path: `code_intel_replace_symbol`, `code_intel_insert_relative`, generic `edit`, or a project codemod when appropriate.
- Prefer `detail: "locations"` when files will be read next; use `detail: "snippets"` when inline context saves a read.
- Let locator-mode output lead to the first source read, and let complete source-mode output stand as the read when it is fresh and complete.
- If an impact map is empty or `ok:false`, read the `reason` and coverage fields to choose the next code-intel tool or fallback search.
