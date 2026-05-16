---
name: code-intelligence
description: "Use when orienting in a large repo or preparing a bounded read-next map for non-trivial code review/edits: repo shape, file outlines, tests, changed files, shared symbols, handlers, config/schema/protocol code, or scoped subsystem mapping."
---

# Code Intelligence

Use `code_intel_*` tools to prepare candidate files and symbols to inspect next. Outputs are routing evidence, not exact references, complete impact, or proof of a defect.

## Core Workflow

1. In a large unfamiliar repo, start with `code_intel_repo_overview` tier `shape`, then scope to tier `files`, then use `code_intel_file_outline` for individual large files.
2. If you have concept/API terms but no anchor file, use `code_intel_repo_route` with scoped paths before falling back to global `rg`.
3. For a concrete edit/review, start from the task boundary: diff, changed files, base ref, or a small set of root symbols.
4. Run `code_intel_impact_map` for review/edit impact context, or `code_intel_local_map` for a scoped subsystem with anchors plus related names.
5. Use `code_intel_test_map` when you need likely tests to inspect or run for a file/symbol/name.
6. Use `code_intel_syntax_search` only for explicit current-source shapes the map cannot express.
7. For locator-mode outputs, use `readHint` for one precise generic read or pass `symbolTarget` to `code_intel_read_symbol` when you need a complete declaration body.
8. Treat a complete `code_intel_read_symbol` segment as the source read; do not generic-read the same range again unless it was truncated, stale, ambiguous, or too narrow for editing.
9. For symbol-scoped mutations, use `code_intel_replace_symbol` only with `oldText` or `oldHash` safety evidence, and use `code_intel_insert_relative` only when inserting before/after a resolved symbol anchor is clearer than manual line edits.
10. After editing/writing, use `code_intel_post_edit_map` when you need changed-symbol, caller/test, or diagnostic follow-up context.
11. Run project-native validation when behavior, public contracts, tests, or generated outputs matter.

## Delegating Review

Builtin subagents may not have code-intel tools. Do not assume a reviewer subagent can call them.

Before delegating review, the parent should usually:

1. Inspect the diff or changed files.
2. Run `code_intel_impact_map` with `changedFiles`, `baseRef`, or root `symbols`.
3. Add any scoped `code_intel_syntax_search` results for known risky syntax patterns.
4. Pass the candidate files/reasons and limitations in the reviewer prompt.

Use a custom code-intel-aware reviewer only when it is explicitly configured with the narrow tools it needs.

## Source Layout for Extension Work

When editing this extension, preserve the vertical-slice layout:

- Put each tool's schema, prompt guidance, registration, and TUI result rendering in `src/slices/<slice>/tool.ts`.
- Put slice behavior in `src/slices/<slice>/run.ts` when it is not shared parser/core behavior.
- Put compact agent-visible output in `src/slices/<slice>/compact.ts`; keep `src/compact-output.ts` as a dispatcher only.
- Put slice-specific parameter types in `src/slices/<slice>/types.ts`; keep `src/types.ts` as compatibility re-exports plus shared types only through `src/core/types.ts`.
- Do not add new tool behavior to `index.ts`; it should only wire lifecycle hooks and slice registrations.

## Tool Selection

- `code_intel_repo_overview`: orientation tool. Use tier `shape` for broad directory counts/languages without parsing declarations; use tier `files` only for explicit subtrees to list files plus capped declaration names.
- `code_intel_file_outline`: single-file orientation. Returns imports/includes and language-native declarations with locator-mode `symbolTarget`/`readHint` fields before reading a large file.
- `code_intel_test_map`: related-test candidates. Uses bounded test-root discovery, path/name evidence, and literal matches; pass file paths plus symbols/domain names for better non-code test results. It filters cache/log artifacts and avoids generic path-only noise where possible.
- `code_intel_repo_route`: concept routing. Ranks likely implementation files for concept/API/function terms using bounded path and literal evidence without dumping raw search output. Scope paths in large repos, then outline/read returned files.
- `code_intel_impact_map`: primary edit/review impact tool. Builds a Tree-sitter current-source candidate read-next map from changed files, root symbols, or a base ref. Impact routing currently covers Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++. Rust routing is syntax-only; C/C++ changed-file routing is scoped for large-repo safety unless explicit paths broaden it. Rows include evidence such as `syntax_call`, `syntax_selector`, and `syntax_keyed_field`. Use `confirmReferences` only for bounded, opt-in Go, TypeScript/JavaScript, or clangd-backed C/C++ exact-reference confirmation when exactness materially reduces risk and C/C++ has a usable `compile_commands.json`.
- `code_intel_local_map`: scoped subsystem map. Uses Tree-sitter current-source rows plus bounded `rg` literal fallback when you have anchors plus related fields/types/API names and want suggested local files to read.
- `code_intel_syntax_search`: explicit in-process Tree-sitter candidate search. Use supported patterns such as `foo($A)`, `$OBJ.Field`, `Field: $VALUE`, wrapper patterns containing those shapes, or raw Tree-sitter queries with captures.
- `code_intel_read_symbol`: source-mode targeted declaration read. Prefer passing a `symbolTarget`; function-like targets return the full body. Optional referenced context is same-file, one-hop, and limited to constants, vars, and types; called functions/helpers are deferred. Segment headers include `hash=<oldHash>` for token-light mutation safety.
- `code_intel_replace_symbol`: mutation tool for replacing one resolved declaration. Requires `oldText` or `oldHash`; prefer `oldHash` from `code_intel_read_symbol` when avoiding large oldText echo is useful.
- `code_intel_insert_relative`: mutation tool for inserting text before/after a resolved declaration anchor. It can consume `symbolTarget` from either `code_intel_file_outline` or `code_intel_read_symbol`.
- `code_intel_post_edit_map`: read-only follow-up map after edits/writes. Returns changed-symbol locators, likely caller/test candidates, and optional diagnostic-focused targets; it does not run tests or fix code.
- `code_intel_state`: inspect Tree-sitter, `rg`, and optional LSP availability, config, footer status, and diagnostics when that matters.

## Guardrails

- Treat repo overview and file outlines as deterministic structure and syntax facts for navigation, not generated architecture explanations.
- Do not expect model summaries or semantic role hints; infer meaning from paths, filenames, imports/includes, and declarations, then read source.
- Treat Tree-sitter output as a read-next queue, not semantic truth.
- Treat `rg` fallback as literal text discovery, not symbol/reference proof.
- Do not turn tool output directly into a review finding; inspect current source first.
- Treat LSP status in `code_intel_state` as availability-only; it is not exact-reference evidence. For C/C++, clangd also depends on a usable `compile_commands.json`; missing or stale compile databases make confirmation unavailable or incomplete.
- Treat `referenceConfirmation` rows from opt-in providers such as `gopls` or `typescript` as confirmation evidence, not a replacement for reading current source.
- Do not use code-intel as a substitute for `gopls`, TypeScript language services, Rust Analyzer, or project-native checks when exact references matter.
- Do not run broad rule scans by default.
- Do not perform rewrites through syntax search.
- Treat `code_intel_replace_symbol` and `code_intel_insert_relative` as narrow mutation tools, not general codemods. Resolve anchors with `symbolTarget`, keep inserted/replacement text scoped, and validate afterward.
- Keep result sets bounded. Prefer `detail: "locations"` when files will be read next; use `detail: "snippets"` only for inline triage.
- Avoid double reads: locator-mode output should lead to the first source read; complete source-mode output should not be followed by a generic read of the same range without a freshness/truncation/ambiguity reason.
- If an impact map is empty or `ok:false`, read the `reason` and `coverage.supportedImpactLanguages` / `unsupportedImpactFiles` / `nonSourceFiles`; do not treat it as a successful no-impact result.
- Use standalone `rg` for comments/docs/generated text, literal fallback beyond caps, or unsupported-language gaps.
