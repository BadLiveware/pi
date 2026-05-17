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
| C# | Parser configured for `.cs`; overview can classify; generic outline may catch some methods/classes; no impact, refs, or diagnostics. | First-class outline/read-symbol for namespaces, classes, records, structs, interfaces, enums, delegates, methods, constructors, properties, fields, events, enum members, and attributes. Impact map for invocations/member access/object initializers. Test-map patterns for xUnit, NUnit, MSTest. | Optional C# LSP references/diagnostics through `csharp-ls`, Roslyn LSP, or OmniSharp adapter selected after spike. `dotnet` status can report project availability but must not run builds by default. |
| Go | Strong support for parser, outline, imports, definitions, fields, calls/selectors/keyed fields, impact, local/test maps, read/mutate symbol, and optional `gopls` references. | Preserve behavior; improve receiver/type owner extraction, interface methods, import blocks, struct tags, test ranking, and package-local scoping. | Add `gopls check` touched-file diagnostics or shared LSP diagnostics. Keep exact refs through existing `gopls references`. |
| Rust | Parser configured; dedicated extractor for functions, traits, impl ownership, structs/enums/modules/types/const/static/macros, fields, calls/macros, field expressions, field initializers; impact is syntax-only; Rust Analyzer status is availability-only. | Improve module/use tree extraction, impl trait owner detection, associated functions, generic types, macro call/definition handling, inline `#[cfg(test)] mod tests`, and test-map ranking. | Add Rust Analyzer exact refs and diagnostics through shared LSP client. Keep Cargo workspace detection bounded. |
| TypeScript / TSX / JavaScript | Best supported: parser, outline, impact, syntax search, local/test maps, read/mutate symbol, TypeScript exact refs, touched-file diagnostics, idle diagnostics. | Preserve compatibility; improve class/property/constructor decorators, overload signatures, dynamic import/require/export forms, JSX component routing, framework test patterns, and baseline/new diagnostic comparison. | Existing TypeScript service remains primary. Optional tsserver LSP can remain status-only unless it improves reliability. |
| Bash | Parser configured for `.sh` and `.bash`; overview can classify; generic extraction is weak; no impact or diagnostics. | First-class shell extractor for functions, command invocations, variable assignments, sourced files, aliases, traps, case labels, heredocs, and shellcheck-safe ranges. Impact map for shell function and sourced-command calls. Test-map patterns for Bats, ShellSpec, and shunit2. | ShellCheck diagnostics for `sh`/`bash`; optional `bash-language-server` references only after usefulness is proven. |
| zsh | `.zsh` currently maps to bash parser by extension but explicit `language: zsh` is unsupported; no dedicated zsh behavior. | Add `zsh` language id or alias using the bash grammar with zsh-specific labels and limitations. Extract zsh functions, autoload/source usage, aliases, and common command calls. Impact map shares shell logic with zsh-specific caveats. | `zsh -n` syntax diagnostics. ShellCheck only for compatible scripts when shell dialect is sh/bash/ksh. Dedicated zsh LSP/grammar remains optional after fixture spike. |
| Python | Parser configured; impact map supports `.py`; generic extractor handles common classes/functions/calls/attributes; imports are regex-scanned; no refs/diagnostics. | Python-specific extractor for classes, sync/async functions, decorated definitions, module constants/assignments, dataclass fields, calls, attributes, keyword arguments, dict keys, imports/from-imports, and nested test functions. | Pyright or basedpyright diagnostics. Exact refs through `pyright-langserver` or `jedi-language-server` if bounded LSP tests are reliable. Ruff can be an optional lint diagnostics provider. |
| Markdown | Classified as doc; route/local literal fallback can find text; no parser, outline, headings, links, or diagnostics. | First-class Markdown scanner for ATX/setext headings, heading-section ranges, frontmatter, links/images, reference definitions, fenced code blocks with language tags, and generated anchors. Outline/read-symbol by heading; local/test map can route docs and code-fence language hints. | Markdownlint diagnostics and optional link checks. Marksman or markdown-oxide references/diagnostics only after provider spike. |
| C++ | Parser configured for C/C++ extensions; impact map supports C/C++; optional clangd exact refs with compile database; basic generic extraction works; changed-file routing is scoped for large-repo safety. | C++ extractor for namespaces, classes/structs/enums, methods, constructors/destructors, operators, templates, using/typedefs, fields, macro definitions, includes, scoped calls, field expressions, and initializer lists. Improved root ranking and same-file/compile-db scoping. | Keep clangd refs; add clangd touched-file diagnostics and compile database status details. |

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
