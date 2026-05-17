# Slice 02: Language Extractors and Import Scanners

## Goal

Implement language-specific declaration, candidate, and import/source-link extraction for the requested languages. This slice establishes reliable syntax facts for file outline, read-symbol, syntax search, and later impact-map support.

## Shared Extractor Contract

Each extractor returns:

- `definitions`: declaration-like records with stable ranges, kind, name, optional owner, optional type, exported/public flag where meaningful, and evidence.
- `candidates`: usage-like records for calls, member/selector access, keyed/object fields, command invocations, link targets, or language-specific equivalents.
- `limitations`: optional language-specific caveats for the current file or extractor.

Each extractor must:

- Use Tree-sitter node ranges or a bounded scanner range.
- Avoid semantic claims such as type-resolved ownership.
- Preserve current `SymbolRecord` shape so downstream tools remain compatible.
- Include snippets only when `detail === "snippets"`.

## Language Tasks

### C# extractor

Files:

- `src/language-support/extractors/csharp.ts`
- `test/csharp.test.ts`

Definitions to support:

- `namespace_declaration`, `file_scoped_namespace_declaration`
- `class_declaration`, `record_declaration`, `record_struct_declaration`, `struct_declaration`
- `interface_declaration`, `enum_declaration`, `delegate_declaration`
- `method_declaration`, `constructor_declaration`, `destructor_declaration`, `operator_declaration`, `conversion_operator_declaration`
- `property_declaration`, `field_declaration`, `event_declaration`, `enum_member_declaration`

Candidates to support:

- `invocation_expression` as `syntax_call`
- `member_access_expression` and conditional member access as `syntax_selector`
- object/collection initializer assignment nodes as `syntax_keyed_field`
- attributes as low-priority selector or metadata candidates

Import scanner:

- `using_directive`
- `global using`
- `extern alias` as source metadata

Fixture acceptance:

- Outline returns namespace, class, record, interface, constructor, method, property, field, and enum member.
- Read-symbol returns a complete method body and a complete property declaration.
- Syntax candidates include `service.Authenticate()` and object initializer `NeedTags = true`.

### Go extractor improvements

Files:

- `src/language-support/extractors/go.ts`
- `test/go-extractor.test.ts` or extend existing fixtures in `index.test.ts`

Definitions to support:

- functions and methods with receiver owner
- type specs: structs, interfaces, aliases, named types
- const and var specs, including grouped specs
- struct fields with tags
- interface methods as declarations owned by the interface

Candidates to support:

- call expressions
- selector expressions, suppressing duplicate selector rows for method-call function parts
- keyed elements in composite literals

Import scanner:

- single imports
- grouped imports
- aliases, dot imports, blank imports in details when useful

Fixture acceptance:

- Method owner is receiver type rather than only current type context.
- Interface method declarations are outline rows but are downranked in changed-file root selection compared with concrete functions unless explicitly requested.
- Struct tags do not break field type extraction.

### Rust extractor improvements

Files:

- `src/language-support/extractors/rust.ts`
- `test/rust.test.ts`

Definitions to support beyond current behavior:

- `use_declaration` and nested use trees for imports only
- `impl_item` owner for `impl Trait for Type` and inherent impls
- associated constants/types/functions inside impls and traits
- tuple struct fields and enum variants with payload fields
- `mod_item` with inline module contents
- macro definitions and macro rules

Candidates to support:

- function calls
- macro invocations
- method calls and field expressions
- scoped identifiers
- struct field initializers and shorthand initializers

Import scanner:

- nested `use` tree summaries
- `mod` declarations

Fixture acceptance:

- Existing Rust tests pass.
- A fixture with `impl Display for Widget` assigns methods to `Widget` or includes trait metadata without claiming semantic type resolution.
- Inline `#[cfg(test)] mod tests` is visible to outline and test-map evidence.

### TypeScript / TSX / JavaScript extractor improvements

Files:

- `src/language-support/extractors/typescript.ts`
- `test/typescript-extractor.test.ts` or existing TS fixture expansion

Definitions to support beyond current behavior:

- function declarations, methods, constructors, getters, setters
- class declarations and class expressions assigned to consts
- interface/type aliases/enums/namespaces
- exported const function variables, arrow functions, function expressions
- public/private/protected class fields and property signatures
- overload signatures with implementation selection for read-symbol

Candidates to support:

- call/new expressions
- member expressions and optional chaining
- object literal pairs and shorthand properties
- JSX opening element names as component-use candidates
- dynamic imports and CommonJS `require` calls

Import scanner:

- static imports and exports
- dynamic `import("...")`
- CommonJS `require("...")`

Fixture acceptance:

- Decorators and overloads do not create duplicate or impossible targets.
- JSX component usage can be routed as a candidate without treating every lowercase tag as a high-signal symbol.

### Bash and zsh shell extractor

Files:

- `src/language-support/extractors/shell.ts`
- `test/shell.test.ts`
- `test/zsh.test.ts`

Definitions to support:

- POSIX function form: `name() { ... }`
- Bash function form: `function name { ... }` and `function name() { ... }`
- aliases as single-line declarations
- top-level variable assignments as low-priority declarations
- traps as event-like declarations with signal names

Candidates to support:

- command invocations from command nodes
- sourced files through `source path` and `. path`
- variable expansions as optional low-priority candidates only when explicitly searched
- function calls in pipelines, conditionals, subshells, and command substitutions

Import/source scanner:

- `source ./file.sh`
- `. ./file.sh`
- zsh `autoload -Uz name`

zsh-specific behavior:

- `.zsh` resolves to logical language `zsh`.
- Parser source remains bash grammar initially.
- Limitations explicitly say zsh-specific syntax may parse imperfectly.

Fixture acceptance:

- Outline returns shell functions and aliases for `.sh`, `.bash`, and `.zsh`.
- Read-symbol returns a complete shell function body.
- Syntax candidates include function calls and sourced files.
- zsh fixture with `autoload -Uz compinit` records `compinit` as source/command metadata without claiming exact references.

### Python extractor

Files:

- `src/language-support/extractors/python.ts`
- `test/python.test.ts`

Definitions to support:

- `function_definition` and async function definitions
- decorated definitions, preserving decorators in source range
- classes
- module-level assignments and annotated assignments as constants/variables
- dataclass fields and class-level annotated assignments
- methods owned by current class

Candidates to support:

- calls
- attributes
- keyword arguments
- dictionary pairs with string and identifier-like keys
- decorators as call/selector candidates where useful

Import scanner:

- `import a`, `import a as b`
- `from a import b`
- relative imports with leading dots preserved

Fixture acceptance:

- Outline returns class, decorated function, async function, module constant, dataclass field, and method owner.
- Impact existing Python changed-file test still passes.
- Syntax candidates include `client.fetch()`, `run_task(name="x")`, and `{ "NeedTags": True }`.

### Markdown scanner/extractor

Files:

- `src/language-support/extractors/markdown.ts`
- `test/markdown.test.ts`

Scanner records:

- frontmatter block as `frontmatter` metadata with range
- ATX headings `#` through `######` as `markdown_section` definitions
- setext headings as `markdown_section` definitions
- fenced code blocks as `code_fence` definitions or metadata rows with language and range
- inline links, image links, autolinks, and reference definitions as candidates

Read-symbol range rules:

- A heading section range starts at the heading line and ends before the next heading with the same or higher level.
- A code fence range starts at the opening fence and ends at the closing fence; unterminated fences end at file end with a diagnostic.
- Frontmatter range is the opening `---` or `+++` block at file start.

Fixture acceptance:

- Outline returns headings with levels and generated slugs.
- Read-symbol on a heading returns only that section.
- Links are candidates with target text.
- Code fence language is visible for test-map/doc routing.

### C++ extractor improvements

Files:

- `src/language-support/extractors/cpp.ts`
- `test/cpp.test.ts`

Definitions to support:

- namespaces as owner context
- class/struct/enum declarations
- function declarations and definitions
- method definitions inside and outside class bodies
- constructors and destructors
- operator overloads
- templates wrapping declarations
- fields
- `using_declaration`, `alias_declaration`, `type_definition`
- preprocessor function-like and object-like macro definitions as low-priority declarations

Candidates to support:

- calls and scoped calls
- field expressions
- qualified identifiers
- initializer-list field-like entries where grammar supports them
- macro invocations as low-priority calls when detectable

Import scanner:

- `#include <...>` and `#include "..."`

Fixture acceptance:

- Existing C++ tests pass.
- Outline returns namespace-owned class, constructor, destructor, method, free function, template function, field, and macro.
- Impact can route `storage.fillData()` without adding duplicate selector rows for the call function part.

## Shared Tests

Add a `test/language-fixtures.ts` helper only if it reduces duplication without hiding fixture source. Each language test should build a tiny git repo in a temp directory and exercise tools through the registered extension, matching existing test style.

Required test groups:

- outline per language
- read-symbol per language for one complete body/section
- syntax candidates per language
- import/source-link scanner per language
- absence/limitation behavior where syntax is intentionally approximate

## Validation

```bash
cd agent/extensions && npm run check:structure
cd agent/extensions && npm run typecheck
cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/test/csharp.test.ts private/code-intelligence/test/shell.test.ts private/code-intelligence/test/zsh.test.ts private/code-intelligence/test/python.test.ts private/code-intelligence/test/markdown.test.ts private/code-intelligence/test/cpp.test.ts private/code-intelligence/test/rust.test.ts
cd agent/extensions && npm test
```

## Exit Criteria

- Each requested language has tested outline and candidate extraction.
- Existing language tests remain green.
- No extractor requires semantic tooling to produce syntax records.
- Downstream map and symbol tools can consume extractor records without per-language special cases in tool slices.
