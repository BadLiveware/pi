# Language Feature Matrix

Legend:

- **Have**: current implementation exists and is tested or directly supported.
- **Improve**: current behavior exists but needs language-specific hardening.
- **Add**: planned new support.
- **Optional provider**: requires local command or language server and must degrade cleanly when missing.

## Cross-Language Feature Layers

1. **Repo overview**: classify file language/category and count files.
2. **File outline**: declarations/sections with locator targets and import/include/source-link summaries.
3. **Read symbol**: complete bounded declaration or section source by target.
4. **Mutate symbol**: replace/insert around a resolved target with `oldHash` or `oldText` safety.
5. **Syntax search**: explicit call/member/keyed/raw patterns.
6. **Impact map**: changed-file or symbol roots mapped to likely callers/consumers.
7. **Local map**: anchored subsystem map with syntax rows plus bounded literal fallback.
8. **Test map**: candidate tests by path/name/literal evidence.
9. **Exact refs**: opt-in language-service reference confirmation.
10. **Diagnostics**: opt-in touched-file diagnostics or explicit provider diagnostics.

## Current and Target Coverage

| Language | Current state | Target baseline | Provider target |
| --- | --- | --- | --- |
| C# | C# outline/read-symbol, syntax impact/local/test routing, and optional `csharp-ls` references/diagnostics are implemented for common declarations and touched files. | Harden edge cases for attributes, generics, partial classes, solution/workspace discovery, and broader test-map patterns. | `csharp-ls` is the initial optional provider for references and touched-file diagnostics; Roslyn LSP or OmniSharp remain future alternatives only if fixtures prove better behavior. |
| Go | Strong support for parser, outline, imports, definitions, fields, calls/selectors/keyed fields, impact, local/test maps, read/mutate symbol, optional `gopls` references, and `gopls check` touched-file diagnostics. | Preserve behavior; improve receiver/type owner extraction, interface methods, import blocks, struct tags, test ranking, and package-local scoping. | Keep exact refs through `gopls references`; diagnostics stay touched-file scoped through `gopls check`. |
| Rust | Parser/extractor, syntax impact/local/test routing, and optional Rust Analyzer exact refs/diagnostics through the shared LSP client are implemented. | Improve module/use tree extraction, impl trait owner detection, associated functions, generic types, macro call/definition handling, inline `#[cfg(test)] mod tests`, and test-map ranking. | Keep Rust Analyzer optional, bounded, and Cargo-workspace aware; default routing remains syntax evidence. |
| TypeScript / TSX / JavaScript | Best supported: parser, outline, impact, syntax search, local/test maps, read/mutate symbol, TypeScript exact refs, touched-file diagnostics, idle diagnostics. | Preserve compatibility; improve class/property/constructor decorators, overload signatures, dynamic import/require/export forms, JSX component routing, framework test patterns, and baseline/new diagnostic comparison. | Existing TypeScript service remains primary. Optional tsserver LSP can remain status-only unless it improves reliability. |
| Bash | Parser configured for `.sh` and `.bash`; overview can classify; generic extraction is weak; no impact or diagnostics. | First-class shell extractor for functions, command invocations, variable assignments, sourced files, aliases, traps, case labels, heredocs, and shellcheck-safe ranges. Impact map for shell function and sourced-command calls. Test-map patterns for Bats, ShellSpec, and shunit2. | ShellCheck diagnostics for `sh`/`bash`; optional `bash-language-server` references only after usefulness is proven. |
| zsh | `.zsh` currently maps to bash parser by extension but explicit `language: zsh` is unsupported; no dedicated zsh behavior. | Add `zsh` language id or alias using the bash grammar with zsh-specific labels and limitations. Extract zsh functions, autoload/source usage, aliases, and common command calls. Impact map shares shell logic with zsh-specific caveats. | `zsh -n` syntax diagnostics. ShellCheck only for compatible scripts when shell dialect is sh/bash/ksh. Dedicated zsh LSP/grammar remains optional after fixture spike. |
| Python | Python-specific outline/extractor, syntax impact/local/test routing, and touched-file diagnostics are implemented with Pyrefly preferred, ty fallback, then basedpyright/pyright fallback. | Improve package/import resolution, nested/decorated edge cases, and framework-aware test ranking. | Python exact refs remain future work with Pyrefly as the default LSP candidate after bounded tests prove reliable; `ty server`, pyright language server, or Jedi are non-default alternatives only if Pyrefly is rejected. Ruff can be an optional lint diagnostics provider. |
| Markdown | Classified as doc; route/local literal fallback can find text; no parser, outline, headings, links, or diagnostics. | First-class Markdown scanner for ATX/setext headings, heading-section ranges, frontmatter, links/images, reference definitions, fenced code blocks with language tags, and generated anchors. Outline/read-symbol by heading; local/test map can route docs and code-fence language hints. | Markdownlint diagnostics and optional link checks. Marksman or markdown-oxide references/diagnostics only after provider spike. |
| C++ | C/C++ extractor, syntax impact/local/test routing, optional clangd exact refs, and clangd touched-file diagnostics with compile database detection are implemented. | Improve root ranking, same-file/compile-db scoping, template/operator edge cases, and macro-heavy code behavior. | Keep clangd optional; provider output depends on usable `compile_commands.json`. |

## Target Tool Behavior by Language

### `code_intel_repo_overview`

- All listed languages should be classified by file extension.
- Markdown remains category `doc` but should also expose `language: markdown` for docs-specific tooling.
- zsh should appear as `zsh` rather than indistinguishable `bash` when `.zsh` is used.

### `code_intel_file_outline`

Required representative outlines:

- C#: namespace, class, record, interface, method, constructor, property, field, enum member.
- Go: package imports, types, functions, methods, const/var, struct fields.
- Rust: use/mod imports, structs/enums/traits/types/modules, impl methods, macros, fields.
- TypeScript: imports/exports, functions, classes, methods, interfaces, type aliases, const function variables, fields.
- Bash/zsh: source includes, functions, aliases, variable assignments, command entrypoints.
- Python: imports, classes, functions, async functions, decorated functions, module constants, dataclass fields.
- Markdown: heading sections, frontmatter block, fenced code blocks, links/reference definitions.
- C++: includes, namespaces, classes/structs/enums, functions, methods, constructors/destructors, templates, fields, macros.

### `code_intel_read_symbol`

- Source-mode complete segments should work for all code-language declaration records.
- Markdown read-symbol should return a heading section, not the whole file, with an explicit `kind: markdown_section` target.
- Shell read-symbol should return complete function bodies where Tree-sitter ranges are reliable; top-level variable/alias targets can return single-line ranges.

### `code_intel_replace_symbol` and `code_intel_insert_relative`

- Existing behavior remains for TS/JS, Go, Rust, Python, and C++ once extractors provide stable ranges.
- C# can support declaration replacement once constructor/property/method ranges are tested.
- Shell replacement should initially support function declarations only; single-line alias/assignment replacements can follow after tests.
- Markdown replacement should initially be limited to complete heading sections and disabled for whole-document root unless the user passes an explicit target.

### `code_intel_syntax_search`

- Generic call/member/keyed patterns should continue where grammar node shapes align.
- Add language adapters where generic names differ:
  - C#: invocation/member/object initializer.
  - Python: call/attribute/keyword argument/dict pair.
  - Shell/zsh: command name, sourced file, variable assignment.
  - Markdown: heading text, link target, code fence language.
  - C++: scoped calls, field expressions, qualified identifiers, macro invocations.

### `code_intel_impact_map`

- Keep default route language list bounded and registry-driven.
- Add C# after extractor has root and candidate tests.
- Add Bash and zsh after shell fixtures prove function-call signal is useful.
- Markdown should not pretend to be code impact; implement doc impact as heading/link/backlink candidates with explicit `basis: docStructureAndLiteralLinks` or keep Markdown out of code impact while explaining doc fallback in coverage.

### `code_intel_test_map`

Add language-specific path heuristics:

- C#: `*.Tests`, `*.Test`, `tests/`, xUnit/NUnit/MSTest naming, `Fact`, `Theory`, `Test`, `TestMethod` literals.
- Go: existing `_test.go`; improve package/function path scoring.
- Rust: `tests/*.rs`, inline `#[cfg(test)]`, `#[test]`, `mod tests`, benches where relevant.
- TypeScript: `.test`, `.spec`, `__tests__`, Playwright/Cypress paths.
- Bash/zsh: `test/*.bats`, `*.bats`, ShellSpec, shunit2 naming.
- Python: `test_*.py`, `*_test.py`, `tests/`, unittest classes, pytest function names.
- Markdown: docs tests, examples, doctest-like code fences, link-check config files.
- C++: `*_test.cc`, `*_test.cpp`, `test/`, `tests/`, `gtest`, `catch`, `doctest`, `boost::ut` literals.
