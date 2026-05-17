# Slice 04: Exact Reference and Diagnostics Providers

## Goal

Expand optional semantic-provider support while preserving the default Tree-sitter evidence model. Providers should add bounded exact references or diagnostics when available, and otherwise return actionable diagnostics without breaking maps.

## Shared Provider Architecture

### 1. Generalize provider metadata

Extend current provider types under `src/lsp/types.ts` or `src/providers/types.ts` to cover both references and diagnostics:

- provider id
- supported language ids
- required command or package
- status probe
- reference capability
- diagnostic capability
- limitations
- missing-tool diagnostic
- workspace prerequisites

Acceptance criteria:

- `code_intel_state` can report provider availability and language support from provider metadata.
- Existing `gopls`, TypeScript, and clangd reference providers are adapted without changing result shape.

### 2. Extract shared LSP session code

Create:

- `src/lsp/json-rpc-client.ts`: message framing, request/notification handling, timeout, stderr capture, abort support.
- `src/lsp/lsp-session.ts`: initialize/initialized/shutdown lifecycle, didOpen helper, references request, diagnostics collection helper.
- `src/lsp/uri.ts`: repo-relative URI conversion and safety checks.

Refactor clangd to use this shared session. Then add new LSP-backed providers using the shared code.

Acceptance criteria:

- Existing clangd tests still pass.
- New tests cover timeout, server error, malformed message, and process kill on abort using a fake LSP command.

## Provider Tasks by Language

### TypeScript / JavaScript

Current provider:

- TypeScript language service exact references.
- TypeScript touched-file syntactic and semantic diagnostics.

Planned improvements:

- Move provider code to shared provider metadata.
- Add baseline/new diagnostic comparison as an optional future-safe field if a pre-edit snapshot exists.
- Preserve idle diagnostic surfacing behavior.

Acceptance criteria:

- Existing TypeScript reference and diagnostic tests pass.
- State output says TypeScript diagnostics are current touched-file diagnostics unless baseline is present.

### Go

Current provider:

- `gopls references` exact references.

Add diagnostics:

- Preferred first pass: `gopls check <file.go>` for touched files.
- Parse output into path, line, column, severity, source `gopls`, code when present, and message.
- Keep diagnostics file-scoped and bounded to touched files.

Optional later pass:

- Use shared LSP session for diagnostics if `gopls check` output is too unstable.

Acceptance criteria:

- Fake `gopls` diagnostics test covers two diagnostics and one clean file.
- Missing `gopls` returns provider unavailable without failing post-edit map.
- Existing `gopls references` test still passes.

### Rust

Add Rust Analyzer provider:

- Status probe: `rust-analyzer --version`.
- Workspace discovery: nearest `Cargo.toml` at or above root file, capped at repo root.
- LSP initialize with repo root or Cargo workspace root.
- Open root/touched file text.
- Exact references through `textDocument/references`.
- Diagnostics through `textDocument/publishDiagnostics` after didOpen, with a bounded wait window and timeout.

Risks:

- Rust Analyzer may perform background Cargo work. Keep timeouts strict and diagnostics best-effort.
- Some references may require workspace readiness. Report partial results with limitations.

Acceptance criteria:

- Fake LSP test proves references are parsed.
- Missing Rust Analyzer status is reported cleanly.
- Real-command integration test is skipped when `rust-analyzer` is unavailable.
- Default Rust impact map does not require Rust Analyzer.

### Python

Add diagnostics provider:

- Preferred order: `pyrefly check --output-format json --summary=none <files>`, then `ty check --output-format gitlab --no-progress <files>`, then `basedpyright --outputjson <files>`, then `pyright --outputjson <files>` when installed.
- Parse each tool's structured diagnostics into normalized rows.
- Respect each tool's own config discovery; do not implement custom type environment logic.

Add reference provider after diagnostics:

- Candidate commands: `pyrefly` LSP, `ty server`, `pyright-langserver --stdio`, or `jedi-language-server`.
- Use shared LSP session for `textDocument/references`.
- Provider should be opt-in only after tool schemas are extended and fake LSP tests cover the selected provider.

Acceptance criteria:

- Fake Pyrefly JSON test covers errors and filters non-touched files.
- Fake ty GitLab JSON test covers fallback diagnostics.
- Fake basedpyright/pyright JSON test covers legacy fallback rows.
- Missing Python providers return unavailable status.
- Python post-edit diagnostics do not run project-wide by default.

### C++

Current provider:

- clangd exact references with compile database detection.

Add diagnostics:

- Reuse shared clangd LSP session.
- Detect compile commands directory as today.
- Open touched files and collect `textDocument/publishDiagnostics` within timeout.
- Report compile database path in details.

Acceptance criteria:

- Existing clangd reference tests pass.
- Missing compile database produces a diagnostic and no crash.
- Fake clangd diagnostics test covers normalized diagnostic rows.

### C#

Provider spike and implementation decision:

1. Probe `csharp-ls` startup and reference behavior in a tiny fixture solution/project.
2. If `csharp-ls` is reliable, implement C# provider with shared LSP session.
3. If not, evaluate OmniSharp or Roslyn LSP command behavior.
4. Choose exactly one initial provider id for references and diagnostics; document alternatives as unsupported until implemented.

Expected behavior:

- Status probe for selected command.
- Workspace discovery from `.sln`, `.csproj`, or repo root.
- References through `textDocument/references`.
- Diagnostics from publishDiagnostics after didOpen.

Acceptance criteria:

- Provider absence test always runs.
- Fake LSP test covers references and diagnostics.
- Real provider test is skipped unless selected command is available.
- C# impact map works without provider.

### Bash and zsh

Diagnostics providers:

- ShellCheck for `.sh` and `.bash` files.
- ShellCheck for `.zsh` only when dialect is explicitly compatible; otherwise skip with limitation.
- `zsh -n` syntax diagnostics for `.zsh`.

ShellCheck command:

- Use JSON output when available.
- Normalize severity, code, line, column, endLine/endColumn when present, source `shellcheck`.
- Cap file count to touched files.

zsh syntax command:

- Run `zsh -n <file>`.
- Parse stderr line references when available.
- Mark source `zsh -n` and severity `error`.

References:

- Do not add Bash language server references in the first provider slice. Tree-sitter command-call impact covers the primary read-next workflow.
- Revisit `bash-language-server` only after a fixture proves it returns useful references for shell functions.

Acceptance criteria:

- Fake ShellCheck JSON test covers normalized diagnostics.
- Fake `zsh -n` test covers syntax error output.
- Missing commands are reported as unavailable, not failures.

### Markdown

Diagnostics providers:

- `markdownlint-cli2` JSON output for touched Markdown files.
- Optional link checker provider remains explicit and non-default because network link checks can be slow or flaky.

References:

- Evaluate Marksman or markdown-oxide LSP only after Markdown outline/link scanning lands.
- If implemented, use it for heading/link references, not code-symbol references.

Acceptance criteria:

- Fake markdownlint output test covers diagnostics.
- Missing markdownlint is unavailable with clear install hint.
- Markdown diagnostics are not run for generated docs unless the user includes generated files.

## Tool Schema Changes

Extend `confirmReferences` enums only when a provider is implemented and tested:

- Existing: `gopls`, `typescript`, `clangd`.
- Add after implementation: `rust-analyzer`, `pyright`, `jedi`, `csharp-ls`, `marksman` if applicable.

For diagnostics, avoid adding a new user-facing enum unless needed. `code_intel_post_edit_map({ includeDiagnostics: true })` should collect all applicable touched-file providers with bounded caps and provider status details.

## Validation

```bash
cd agent/extensions && npm run check:structure
cd agent/extensions && npm run typecheck
cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/test/*diagnostic*.test.ts private/code-intelligence/test/*provider*.test.ts private/code-intelligence/test/cpp.test.ts private/code-intelligence/test/index.test.ts
cd agent/extensions && npm test
```

Provider-specific real-command checks can be documented as manual smoke checks and skipped automatically when commands are missing.

## Exit Criteria

- Provider metadata is centralized and surfaced through state.
- Existing providers are preserved.
- New providers fail closed with diagnostics and limitations.
- Post-edit diagnostics cover the requested languages where reliable tools are available.
- Exact references remain opt-in and language-provider-specific.
