# Slice 03: Map and Symbol Tool Integration

## Goal

Use the new language extractors to expand impact maps, local maps, test maps, read-symbol, and mutation tools while keeping result shapes compatible and limitations explicit.

## Affected Areas

- `src/tree-sitter/impact.ts`
- `src/impact-support.ts` or registry-backed replacement
- `src/slices/impact-map/run.ts`
- `src/slices/local-map/run.ts`
- `src/slices/orientation/run.ts`
- `src/slices/targeted-symbols/run.ts`
- `src/slices/symbol-mutations/run.ts`
- `src/slices/test-map/` or current test-map implementation in orientation slice
- `src/source-range.ts`
- `test/impact-unsupported.test.ts`
- new language tests from Slice 02

## Implementation Tasks

### 1. Make impact support registry-driven

Replace `IMPACT_LANGUAGES` hard-coding with registry-derived capabilities.

Required capability fields:

- `impactMode: "code" | "doc" | "none"`
- `impactDefaultEnabled: boolean`
- `impactLimitations: string[]`
- `largeRepoDefaultScope?: "changed-files" | "repo"`

Initial target:

- Code impact enabled: Go, Rust, TypeScript, TSX, JavaScript, Python, C++, C# after tests pass, Bash after tests pass, zsh after tests pass.
- Doc impact: Markdown, disabled from normal code impact unless changed Markdown files are supplied or explicit symbols/headings are requested.
- None: languages outside this plan unless future registry rows opt in.

Acceptance criteria:

- `coverage.supportedImpactLanguages` is generated from the registry.
- Unsupported and non-source changed-file reporting remains as clear as current behavior.
- Existing unsupported impact tests are updated for Markdown doc behavior and zsh language classification.

### 2. Add C# impact routing

Root symbols:

- class/record/struct/interface/enum names
- methods, constructors, properties, fields, enum members, delegates

Related candidates:

- invocations matching method/function names
- member access matching property/field/method names
- object initializer assignments matching property/field names
- attributes only when explicitly requested by symbol

Ranking rules:

- Prefer same namespace/project path.
- Prefer tests after source files unless the root file is a test.
- Downrank generic names such as `Get`, `Set`, `ToString`, `Equals`, `Configure`, `Build` unless exported/public and explicitly changed.

Acceptance criteria:

- Changed `.cs` file produces roots.
- Symbol query for a C# method returns invocation candidates.
- Property symbol query returns member access and initializer candidates.
- Limitations mention syntax-only same-name risk.

### 3. Add shell and zsh impact routing

Root symbols:

- function declarations
- aliases when explicitly requested
- top-level variables only when explicitly requested

Related candidates:

- command invocations matching function or alias names
- sourced-file links for `source` and `.` statements

Ranking rules:

- Prefer same directory and sibling scripts.
- Prefer test scripts when root file is under `scripts/` and test candidate path includes `test`, `tests`, `bats`, or `spec`.
- Downrank common commands such as `echo`, `printf`, `cd`, `test`, `[`, `grep`, `sed`, `awk`, `cat`, `rm`, `mkdir`, `command`, `local`, `typeset`, and `export`.

Acceptance criteria:

- Changed `.sh` and `.zsh` files produce function roots.
- Calls in other scripts are returned as `syntax_call` or `shell_command` candidates.
- Common external commands do not become changed-file roots unless explicitly requested.
- zsh output carries a bash-grammar compatibility limitation.

### 4. Decide Markdown impact behavior

Implement one of two explicit behaviors. Prefer Option A unless user-facing tests show Option B is clearly useful.

Option A: doc-aware unsupported explanation

- Markdown files remain outside `code` impact.
- Changed Markdown files appear under `docFiles` or `nonCodeImpactFiles` rather than generic `nonSourceFiles`.
- Output suggests `repo_route`, `local_map` literal fallback, or `file_outline` for Markdown sections.

Option B: doc impact mode

- Changed Markdown headings become doc roots.
- Link references, heading anchors, and code fence language tags become related doc candidates.
- Output basis is `docStructureAndLiteralLinks`.
- Limitations say this is documentation routing, not code impact.

Acceptance criteria for chosen option:

- Changed `README.md` output is deliberate and documented.
- Existing non-source changed-file test is updated to expect Markdown-specific handling.

### 5. Update read-symbol and mutation resolution

Adjust `source-range.ts` and targeted-symbol resolution to understand new target kinds:

- C# method/property/constructor/field/class targets.
- Shell function targets.
- Markdown section/code-fence/frontmatter targets.
- C++ template and out-of-class method targets.
- Python decorated function/class range includes decorators.

Mutation policy:

- Allow replace/insert for code declaration targets with stable ranges.
- Allow shell function replacement after hash/text check.
- Allow Markdown heading-section replacement only when target kind is `markdown_section`; disallow replacing synthetic whole-document roots unless a future explicit parameter is added.
- Keep all mutations requiring `oldHash` or `oldText` as today.

Acceptance criteria:

- Read-symbol tests cover one target for each requested language.
- Replace-symbol test covers C# method, Python decorated function, shell function, and Markdown section in addition to existing TS/Go tests.
- Insert-relative test covers Markdown heading insertion and C# method insertion.

### 6. Improve local-map language behavior

Current local map uses Tree-sitter impact, optional selector syntax, and `rg` fallback. Update it to:

- Use registry aliases for `params.language`, including `zsh`, `c#`, `c++`, `py`, and `md`.
- Use language-specific selector/member adapters where generic `$X.name` is not enough.
- Include Markdown link/heading matches when language is Markdown.
- Keep literal fallback for comments, docs, generated files, and unsupported-language gaps.

Acceptance criteria:

- Local map works for `language: "c#"`, `language: "zsh"`, `language: "py"`, `language: "markdown"`, and `language: "c++"`.
- Batching behavior remains one parse pass for selector batch searches per language.

### 7. Expand test-map heuristics

Move test-map language-specific constants to a registry-backed module, for example `src/slices/test-map/language-heuristics.ts`.

Implement path/literal patterns from `docs/language-feature-matrix.md`.

Acceptance criteria:

- C# fixture maps production class/method to xUnit/NUnit/MSTest-like tests.
- Shell fixture maps `scripts/deploy.sh` to Bats/ShellSpec tests.
- Python fixture maps module to pytest and unittest tests.
- Rust fixture maps source module to integration and inline test evidence.
- C++ fixture maps source file to gtest/Catch2/doctest-like tests.
- Markdown fixture maps docs pages to link-check/docs test files when terms match.

## Validation

```bash
cd agent/extensions && npm run check:structure
cd agent/extensions && npm run typecheck
cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/test/impact-unsupported.test.ts private/code-intelligence/test/csharp.test.ts private/code-intelligence/test/shell.test.ts private/code-intelligence/test/zsh.test.ts private/code-intelligence/test/python.test.ts private/code-intelligence/test/markdown.test.ts private/code-intelligence/test/cpp.test.ts private/code-intelligence/test/rust.test.ts
cd agent/extensions && npm test
```

## Exit Criteria

- Impact coverage is registry-driven and tested for every enabled language.
- Read-symbol and symbol mutation behavior is range-stable for supported new target kinds.
- Local-map and test-map behavior uses language metadata instead of scattered pattern constants.
- Markdown behavior is explicit rather than being treated as an accidental unsupported source file.
