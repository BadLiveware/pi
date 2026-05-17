# Package and Tooling Map

## Current Package Baseline

`agent/extensions/private/code-intelligence/package.json` currently depends on:

- `@vscode/tree-sitter-wasm`: in-process Tree-sitter WASM grammars and runtime.
- `typescript`: TypeScript language service and diagnostics.

`@vscode/tree-sitter-wasm@0.3.1` includes the needed grammars for Go, TypeScript, TSX, JavaScript, Rust, Python, C++, C#, and Bash. It does not include Markdown or a distinct zsh grammar.

## Recommended Runtime Package Strategy

### Keep mandatory dependencies minimal

Do not add mandatory language-server or linter packages to `dependencies`. Treat language servers, compilers, and linters as optional local tools discovered by `code_intel_state` and provider execution.

### Parser packages

- **No new parser package required** for C#, Go, Rust, TypeScript, Bash, Python, or C++.
- **zsh initial support** should reuse the bash grammar and expose a separate logical `zsh` language id with zsh-specific limitations.
- **Markdown initial support** should use an internal line scanner for headings, frontmatter, links, reference definitions, and code fences. This avoids a new parser build pipeline.
- **Markdown parser upgrade path**: if the internal scanner becomes too limited, add `mdast-util-from-markdown` as a runtime dependency. Use it only for Markdown AST parsing; keep code-fence embedded language parsing out of scope unless explicitly added later.
- **Dedicated zsh grammar upgrade path**: if zsh-specific fixtures fail badly under the bash grammar, bundle a generated WASM grammar under `private/code-intelligence/vendor/wasm/` and extend the parser loader to support extension-owned WASM paths.

### LSP/JSON-RPC packages

Current clangd code contains a small JSON-RPC client. Preferred refactor:

- Extract a shared internal LSP client to `src/lsp/json-rpc-client.ts` and `src/lsp/lsp-session.ts`.
- Keep no new dependency for the first pass.
- Add `vscode-jsonrpc` and `vscode-languageserver-protocol` only if the internal shared client becomes harder to maintain than the dependency surface.

If those packages are added, place them in `dependencies`, not dev-only dependencies, because the extension runs in Pi at runtime.

## Optional External Tooling by Language

These are not npm package dependencies unless explicitly noted. They are local commands or language servers that providers can discover.

| Language | Optional tool | Use | Provider behavior |
| --- | --- | --- | --- |
| C# | `csharp-ls` | LSP references and diagnostics | Preferred lightweight C# provider candidate. Detect command, start bounded LSP session, open touched/root files, request references or collect diagnostics. |
| C# | OmniSharp | References and diagnostics fallback | Use only if command-line startup and protocol behavior are reliable in tests. |
| C# | Roslyn LSP / `Microsoft.CodeAnalysis.LanguageServer` | References and diagnostics | Candidate for modern .NET workspaces; select after spike because install path varies. |
| C# | `dotnet` | Status/project discovery | Report SDK availability and solution/project files. Do not run `dotnet build` by default. |
| Go | `gopls` | Exact references and touched-file diagnostics | Provider uses `gopls references`; diagnostics use `gopls check` for touched files. |
| Go | `go` | Project status/test hints | Status can report availability. Do not run `go test` automatically from code-intel tools. |
| Rust | `rust-analyzer` | References and diagnostics | Use shared LSP client. Requires bounded Cargo workspace initialization and timeout. |
| Rust | `cargo` | Workspace status and test-map hints | Report availability and detect `Cargo.toml`. Do not run builds/tests by default. |
| TypeScript/JS | `typescript` package | Existing references and diagnostics | Mandatory runtime dependency already present. |
| TypeScript/JS | `tsserver` or `typescript-language-server` | Availability/status | Existing state checks. Use only if a future provider needs LSP behavior. |
| Bash | `shellcheck` | Diagnostics | Run bounded touched-file diagnostics with shell dialect. Return severity, code, message, line/column. |
| Bash | `bash-language-server` | Optional references | Add only after a fixture proves better value than Tree-sitter command-call routing. |
| Bash | `shfmt` | Formatting/status only | Not part of code-intel behavior unless a future formatting tool is created. |
| zsh | `zsh` | Syntax diagnostics | Use `zsh -n <file>` for touched-file syntax diagnostics. |
| zsh | `shellcheck` | Compatible-shell diagnostics | Use only when script dialect is sh/bash/ksh-compatible or the file opts in. Do not label ShellCheck output as full zsh validation. |
| Python | `pyrefly` | Preferred diagnostics | Prefer `pyrefly check --output-format json --summary=none` for touched-file diagnostics when available. |
| Python | `ty` | Fallback diagnostics | Use `ty check --output-format gitlab --no-progress` as the next structured diagnostics fallback. |
| Python | `basedpyright` or `pyright` | Legacy fallback diagnostics | Use CLI `--outputjson` for touched-file diagnostics after Pyrefly/ty are unavailable. |
| Python | Pyrefly LSP (`pyrefly lsp`) | Default exact-reference provider | Uses the shared LSP client for opt-in `textDocument/references` after fake LSP tests prove bounded locations. |
| Python | `ty server`, `pyright-langserver`, or `jedi-language-server` | Non-default exact-reference alternatives | Evaluate only if Pyrefly cannot provide reliable bounded locations in fixture tests. |
| Python | `ruff` | Syntax/lint diagnostics | Optional supplemental diagnostics. Keep separate from type diagnostics. |
| Markdown | `markdownlint-cli2` | Markdown diagnostics | Run on touched Markdown files with JSON output. |
| Markdown | `marksman` or `markdown-oxide` | Links/references/diagnostics | Optional LSP provider after spike. |
| Markdown | `lychee` or `markdown-link-check` | Link diagnostics | Optional explicit link-check provider, not default because network checks can be slow or flaky. |
| C++ | `clangd` | Exact refs and touched-file diagnostics | Shared LSP provider supports references and publishDiagnostics with compile database detection. |
| C++ | `compile_commands.json` | clangd prerequisite | Detect common locations and report the chosen compile DB directory. |

## `package.json` Changes by Phase

### Phase 1: Registry/refactor

Expected dependency changes: none.

Expected source-only changes:

- Move package/runtime knowledge into `src/language-support/registry.ts`.
- Keep `@vscode/tree-sitter-wasm` as the parser source.

### Phase 2: Markdown scanner

Expected dependency changes: none for the first implementation.

If the scanner is rejected during implementation because Markdown edge cases are too broad, add:

```json
{
  "dependencies": {
    "mdast-util-from-markdown": "^2"
  }
}
```

Acceptance for adding the dependency: tests prove the AST parser materially improves heading/link/frontmatter correctness over the internal scanner, and the package works under Pi's runtime module loading.

### Phase 3: Shared LSP client

Expected dependency changes: none for the first implementation.

If maintenance risk justifies library support, add:

```json
{
  "dependencies": {
    "vscode-jsonrpc": "^8",
    "vscode-languageserver-protocol": "^3"
  }
}
```

Acceptance for adding these dependencies: clangd, Rust Analyzer, and one other provider share protocol code with less custom parsing, and tests cover timeout, abort, server error, and malformed message behavior.

## State and Capability Reporting

`code_intel_state` should report:

- parser runtime status
- `rg` status
- optional provider status by provider id
- language capability summary generated from the registry
- provider limitations and missing-tool diagnostics only when `includeDiagnostics` is true, except for concise status counts in normal output

Suggested structured shape:

```ts
{
  languages: {
    csharp: {
      extensions: [".cs"],
      parser: "tree-sitter-c-sharp",
      features: {
        overview: "yes",
        outline: "yes",
        impact: "planned-or-yes",
        exactReferences: ["csharp-ls"],
        diagnostics: ["csharp-ls"]
      },
      limitations: ["..."]
    }
  }
}
```

Use compact strings in rendered output and richer details in tool details.
