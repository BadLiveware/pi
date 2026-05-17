# Slice 01: Capability Registry and Parser Refactor

## Goal

Create the architecture that lets new language support land without expanding `src/tree-sitter.ts` or duplicating hard-coded language lists across tools, state output, docs, and tests.

## Affected Areas

- `agent/extensions/private/code-intelligence/src/languages.ts`
- `agent/extensions/private/code-intelligence/src/impact-support.ts`
- `agent/extensions/private/code-intelligence/src/tree-sitter.ts`
- `agent/extensions/private/code-intelligence/src/rust-records.ts`
- `agent/extensions/private/code-intelligence/src/slices/state/run.ts`
- `agent/extensions/private/code-intelligence/src/slices/state/tool.ts`
- `agent/extensions/private/code-intelligence/src/slices/orientation/run.ts`
- `agent/extensions/private/code-intelligence/src/slices/syntax-search/run.ts`
- `agent/extensions/private/code-intelligence/test/`

## Implementation Tasks

### 1. Add a registry-driven language model

Create `src/language-support/types.ts` with shared types:

- `LanguageId`
- `ParserSource`
- `LanguageFeatureSupport`
- `LanguageCapability`
- `LanguageExtractor`
- `ImportScanner`
- `SyntaxAdapter`
- `DiagnosticProviderId`
- `ReferenceProviderId`

Create `src/language-support/registry.ts` with one entry per logical language:

- `csharp`: `.cs`, aliases `c#`, `cs`, parser `tree-sitter-c-sharp.wasm`, extractor `csharp`, impact initially false until Slice 03.
- `go`: `.go`, aliases `golang`, parser `tree-sitter-go.wasm`, extractor `go`, impact true.
- `rust`: `.rs`, aliases `rs`, parser `tree-sitter-rust.wasm`, extractor `rust`, impact true.
- `typescript`: `.ts`, `.mts`, `.cts`, aliases `ts`, parser `tree-sitter-typescript.wasm`, extractor `typescript`, impact true.
- `tsx`: `.tsx`, parser `tree-sitter-tsx.wasm`, extractor `typescript`, impact true.
- `javascript`: `.js`, `.mjs`, `.cjs`, `.jsx`, aliases `js`, `jsx`, parser `tree-sitter-javascript.wasm`, extractor `typescript`, impact true.
- `bash`: `.sh`, `.bash`, aliases `sh`, parser `tree-sitter-bash.wasm`, extractor `shell`, impact initially false until shell fixtures pass.
- `zsh`: `.zsh`, aliases `zshell`, parser `tree-sitter-bash.wasm`, extractor `shell`, impact initially false until shell fixtures pass, limitations include bash-grammar compatibility.
- `python`: `.py`, aliases `py`, parser `tree-sitter-python.wasm`, extractor `python`, impact true.
- `markdown`: `.md`, `.mdx`, `.markdown`, `.mdc`, parser source `scanner`, extractor `markdown`, impact doc-only.
- `cpp`: `.c`, `.cc`, `.cpp`, `.cxx`, `.h`, `.hh`, `.hpp`, `.hxx`, aliases `c`, `c++`, parser `tree-sitter-cpp.wasm`, extractor `cpp`, impact true.

Acceptance criteria:

- Every requested language has a registry row.
- Aliases used by tool parameters resolve through one function.
- Extension-to-language lookup comes from the registry.
- Impact-supported language list comes from the registry rather than a separate hard-coded array.

### 2. Keep compatibility exports while moving implementation

Create these modules:

- `src/tree-sitter/loader.ts`: `loadTreeSitter`, `parserFor`, WASM path resolution.
- `src/tree-sitter/parse.ts`: `parseFiles`, file collection, include/exclude globs.
- `src/tree-sitter/nodes.ts`: `TreeSitterNode`, `ParsedFile`, `nodeText`, `namedChildren`, `childForField`, location helpers.
- `src/tree-sitter/records.ts`: `extractFileRecords`, extractor dispatch, `SymbolRecord`.
- `src/tree-sitter/impact.ts`: `runTreeSitterImpact` and impact ranking helpers.
- `src/tree-sitter/syntax-patterns.ts`: call/member/keyed/raw query parsing and syntax-match collection.

Then reduce `src/tree-sitter.ts` to compatibility exports from those modules. If a single-step move is too large, first extract `nodes`, `loader`, and `parse`, then move records/impact/syntax in separate commits.

Acceptance criteria:

- Existing imports from `../../tree-sitter.ts` still compile.
- No language-specific additions are made to the old large file.
- Existing tests pass before any new language behavior is added.

### 3. Move record extraction behind language extractors

Create:

- `src/language-support/extractors/generic.ts`
- `src/language-support/extractors/rust.ts`
- `src/language-support/extractors/typescript.ts`
- `src/language-support/extractors/go.ts`
- `src/language-support/extractors/python.ts`
- `src/language-support/extractors/cpp.ts`
- `src/language-support/extractors/csharp.ts`
- `src/language-support/extractors/shell.ts`
- `src/language-support/extractors/markdown.ts`

Initial move:

- Move current generic extractor into `generic.ts`.
- Move current Rust extractor from `src/rust-records.ts` into `extractors/rust.ts`, leaving `src/rust-records.ts` as a temporary compatibility export if needed.
- Register extractor dispatch from the language registry.

Acceptance criteria:

- Current Rust tests still pass.
- Current TS/Go/Python/C++ tests still pass through the generic extractor before language-specific improvements land.

### 4. Centralize imports/includes/source-link scanning

Create `src/language-support/imports.ts`.

Move current `importsFor` regex behavior from orientation into language-specific scanners:

- Go import declarations and import blocks.
- Rust `use` and `mod` declarations.
- Python `import` and `from ... import`.
- TS/JS imports and re-exports.
- C/C++ includes.
- C# `using` directives.
- Shell `source` and `.` includes.
- Markdown links and code fence language summaries.

Acceptance criteria:

- `code_intel_file_outline` imports/sourceLinks are generated from the registry scanner.
- Existing import tests pass.
- New tests cover one scanner per requested language.

### 5. Make state output capability-aware

Update `src/slices/state/run.ts` and compact rendering to include a bounded capability summary from the registry.

Normal state output should remain short, for example:

```text
languages: ts/go/rust/py/cpp strong · csharp/shell parser · markdown docs
```

Structured details should include full per-language features.

Acceptance criteria:

- `code_intel_state` details expose all requested languages.
- Existing state tests are updated to assert registry-derived support rather than hand-coded strings.
- Missing optional providers do not make parser/literal state fail.

## Validation

```bash
cd agent/extensions && npm run check:structure
cd agent/extensions && npm run typecheck
cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/test/index.test.ts private/code-intelligence/test/rust.test.ts private/code-intelligence/test/cpp.test.ts
cd agent/extensions && npm test
```

## Exit Criteria

- The language registry is the source of truth for extensions, aliases, parser specs, impact support, and state capability output.
- `src/tree-sitter.ts` no longer needs direct edits for new language behavior.
- Existing behavior is preserved before functional expansion begins.
