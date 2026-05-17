# Code Intelligence Language Expansion Plan

## Purpose

Expand the private `code-intelligence` extension from a TS/Go-centered syntax router into a broader multi-language context system for C#, Go, Rust, TypeScript, Bash, zsh, Python, Markdown, and C++ while preserving its current evidence model: bounded current-source routing, explicit limitations, no hidden indexes, and no claims of semantic proof without an opt-in language-service provider.

## Desired End State

The extension should provide the most reasonable feature set per language without turning into a compiler or full IDE:

1. A single authoritative language capability registry drives parser selection, aliases, file extensions, feature flags, status output, impact support, and documentation.
2. Tree-sitter parsing and record extraction are organized by language instead of growing `src/tree-sitter.ts`.
3. Each listed language has an explicit support tier for:
   - repo overview and file outline
   - imports/includes/source-links extraction
   - declaration extraction for read-symbol targets
   - syntax candidates for calls, selectors/member access, keyed fields/object fields, and language-specific equivalents
   - impact-map roots and related rows where the syntax signal is useful
   - local-map integration and literal fallback
   - test-map path/literal heuristics
   - optional exact references where a reliable provider exists
   - optional touched-file diagnostics where a reliable provider exists
4. Existing TypeScript, Go, Rust, Python, and C++ behavior remains compatible with current tool names and result shapes.
5. C#, Bash, zsh, and Markdown move from parser/doc-only status to documented, tested, agent-usable capabilities.
6. README and the bundled `code-intelligence` skill include a truthful language coverage table that matches the registry and tests.

## Observed Facts From Current Source

- Parser specs live in `agent/extensions/private/code-intelligence/src/languages.ts`.
- Current parser package is `@vscode/tree-sitter-wasm`; version `0.3.1` ships WASM grammars for bash, C#, C++, Go, JavaScript, Python, Rust, TSX, TypeScript, and related languages, but not Markdown or a distinct zsh grammar.
- Impact support is hard-coded in `src/impact-support.ts` as Go, TypeScript, TSX, JavaScript, Rust, Python, and C++.
- `src/tree-sitter.ts` currently owns parser loading, parsing, generic extraction, syntax search patterns, and impact-map logic. It is already large and should not receive more language behavior directly.
- Rust has a dedicated extractor in `src/rust-records.ts`.
- Optional exact-reference providers exist for Go (`gopls` command), TypeScript/JavaScript (TypeScript language service), Rust (`rust-analyzer`), C++ (`clangd` LSP with `compile_commands.json`), and C# (`csharp-ls`). Python reference support remains planned with Pyrefly as the default Python LSP once fixture tests prove reliable locations.
- Touched-file diagnostics collect TypeScript/JavaScript, Go, Rust, Python, C/C++, C#, shell/zsh, and Markdown diagnostics through optional bounded providers where applicable.
- State output reports availability for semantic providers from the provider metadata registry.
- Tests are under `agent/extensions/private/code-intelligence/test/` and extension-wide validation is run from `agent/extensions`.

## Scope

In scope:

- Refactoring code-intel language metadata and parser/extractor organization.
- Adding or improving language extractors for all requested languages.
- Adding impact-map support where syntax evidence is strong enough to be useful.
- Adding optional provider integrations for exact references and diagnostics when provider setup can be bounded and failure-tolerant.
- Updating tests, README, skill guidance, tool descriptions, compact output where coverage language changes.
- Recording limitations explicitly in outputs and docs.

Out of scope for this plan:

- Building a persistent semantic index.
- Running project-wide builds or test suites automatically by default.
- General codemods or syntax-search rewrites.
- Full type inference for any language.
- Mandatory installation of language servers or linters on user machines.
- Replacing project-native validation commands.

## Global Constraints

- Keep `index.ts` as registration/wiring only.
- Do not add behavior to already-large files except as compatibility exports during refactor.
- Preserve existing public tool names, parameter names, default caps, and result fields unless a compatibility note is documented.
- New provider failures must degrade to diagnostics and limitations, not break default Tree-sitter maps.
- Use bounded parsing, max result caps, timeout/cancellation support, and scoped paths for large repos.
- Treat Tree-sitter matches as candidate read-next evidence. Exact-reference claims require an explicit provider result.
- Keep normal tool output compact; expose richer capability details through structured details and `code_intel_state`.

## Execution Order

1. [Capability registry and parser refactor](slices/01-capability-registry-and-parser-refactor.md)
2. [Language extractors and import scanners](slices/02-language-extractors-and-import-scanners.md)
3. [Impact, local-map, test-map, and symbol-tool integration](slices/03-map-and-symbol-tool-integration.md)
4. [Exact reference and diagnostics providers](slices/04-reference-and-diagnostics-providers.md)
5. [Markdown support and documentation rollout](slices/05-markdown-and-docs-rollout.md)

The first slice is mandatory before adding substantial language behavior. Slices 2 and 3 can proceed language-by-language after the registry exists. Slice 4 can be delivered incrementally by provider. Slice 5 may begin early for docs but should finish after the code behavior is validated.

## Reviewable Milestones

### Milestone A: Architecture Ready

- `src/tree-sitter.ts` becomes a compatibility barrel or small facade.
- Language metadata, parser loading, record extraction, syntax matching, and impact routing have bounded modules.
- No user-visible behavior changes except state output may expose a capability matrix.
- Validation: `cd agent/extensions && npm run check:structure && npm run typecheck && npm test`.

### Milestone B: Parser-Language Coverage

- C#, Bash, zsh, Python, C++, Rust, Go, and TypeScript have language-specific extractor tests.
- Markdown has a first-class scanner or documented parser decision.
- File outline and read-symbol work for the target declaration shapes listed in the language matrix.
- Validation: targeted language tests plus full extension test command.

### Milestone C: Routing Coverage

- Impact map supports C# and shell where extractor signal is useful.
- Existing impact languages continue to pass tests.
- Test-map heuristics include language-specific test file patterns for C#, shell/zsh, Python, Rust, Go, TS, Markdown docs, and C++.
- Validation: language-specific impact and test-map fixture tests.

### Milestone D: Provider Coverage

- New optional providers are added with clear availability/status output and graceful failures.
- Rust Analyzer, Python diagnostics (Pyrefly/ty/basedpyright/pyright), clangd diagnostics, ShellCheck, zsh syntax checks, Markdown lint, and csharp-ls are implemented only where bounded behavior is reliable.
- Validation: provider unit tests with fake commands/LSP fixtures; provider absence tests prove default tools still work.

### Milestone E: Documentation and Agent Guidance

- README and `skills/code-intelligence/SKILL.md` accurately describe per-language support.
- Tool descriptions mention supported provider names and language limitations without overstating exactness.
- Validation: docs read-through plus prompt-behavior review for agent-facing language coverage claims.

## Final Acceptance Criteria

- `code_intel_state` returns a structured language capability summary covering all requested languages.
- `code_intel_file_outline` succeeds on representative fixtures for each requested language, including Markdown headings and zsh files.
- `code_intel_read_symbol` returns complete bounded source segments for representative declarations or sections in each requested language where mutation/read-symbol is supported.
- `code_intel_impact_map` supports Go, Rust, TypeScript/JS, Python, C++, C#, Bash, and zsh with language-appropriate limitations; Markdown changed files are handled as doc routing rather than silently appearing unsupported.
- Optional exact-reference providers remain opt-in and are available for Go, TypeScript/JS, C++, Rust, and C# when local tooling is available; Python exact references remain planned with Pyrefly as the default LSP provider after tests land.
- Optional diagnostics are available for TypeScript/JS, Go, Rust, Python, C++, C#, Bash/zsh, and Markdown when local tooling is available.
- Missing optional providers produce actionable diagnostics and do not fail default Tree-sitter routing.
- Extension structure, typecheck, and tests pass from `agent/extensions`.

## Validation Commands

Run from the repository root unless noted:

```bash
cd agent/extensions && npm run check:structure
cd agent/extensions && npm run typecheck
cd agent/extensions && npm test
cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/test/*.test.ts
```

For provider-specific work, add focused tests with fake commands or local fixture workspaces so CI does not depend on installed language servers. When a provider test needs a real local command, guard it with a command-availability skip and include an absence/failure test that always runs.

## Performance Shape

- Work unit: repository files parsed by language and path scope.
- Current caps to preserve: `maxResults`, `maxRootSymbols`, `maxFiles`, `maxFilesPerDir`, `timeoutMs`, and command output caps.
- New per-language scanners must parse each file at most once per tool invocation.
- Batch selector searches should remain batched by parse pass, as `code_intel_local_map` already does.
- LSP providers must cap roots/results, open only required files, respect `AbortSignal`, enforce timeouts, and kill child processes.
- Markdown link/code-fence scanning must stream line-by-line or use bounded AST parsing; large documents must return truncated sections rather than full-doc dumps.

## Risks and Rollback Points

- **Extractor false positives:** Keep exactness language in limitations and use fixture tests for same-name unrelated symbols.
- **Large-file parsing cost:** Keep path scoping, timeout, and result caps. Roll back any language added to impact support if large-repo scans become slow.
- **Provider startup fragility:** Provider absence must be a normal diagnostic. Default Tree-sitter output must not depend on providers.
- **C++ compile database issues:** Keep clangd provider opt-in and report compile database location/status.
- **zsh grammar mismatch:** Start with zsh-as-shell support and explicitly label unsupported zsh-specific syntax. Add a dedicated grammar only after fixture evidence proves value.
- **Markdown mutation risk:** Initially support read/outline/navigation; allow heading-section replace/insert only after tests prove range stability.
- **Structure guard failures:** Refactor before adding language code; split modules before files approach the guard threshold.

## References

- [Language feature matrix](docs/language-feature-matrix.md)
- [Package and tooling map](docs/package-and-tooling-map.md)
