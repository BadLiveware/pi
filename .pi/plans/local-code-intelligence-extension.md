# Local Code Intelligence Extension

## Purpose

Maintain a private Pi extension that gives agents compact, local read-next evidence for code review and implementation work. The extension should help agents choose which files and symbols to inspect next without claiming compiler-authoritative completeness.

The current product boundary is:

- Tree-sitter WASM for fast current-source syntax routing.
- Bounded `rg` fallback for literal text, docs/comments, generated files, and unsupported-language gaps.
- Optional language-server status plus opt-in Go and TypeScript/JavaScript exact-reference confirmation when Tree-sitter candidates are too noisy or insufficient.

This plan supersedes the earlier Cymbal/sqry/ast-grep/indexing direction.

## Agent Patterns This Solves

The extension is designed around recurring agent behavior, not around exposing every possible code-navigation capability.

| Agent pattern | Failure mode | Code-intel response |
| --- | --- | --- |
| Reviews inspect only the edited files. | Agents miss unchanged callers, consumers, tests, config paths, and protocol boundaries affected by a change. | `code_intel_impact_map` turns changed files, root symbols, or a base ref into a bounded candidate read-next list before findings or edits. |
| Agents hand-roll broad `rg` regexes for context. | Regex soups such as `rg "func Foo|Foo.*Bar|Bar" ...` mix definitions, comments, strings, and unrelated names, then agents over-trust the result. | `code_intel_local_map` makes this a structured workflow: anchors, related names, Tree-sitter rows, bounded literal fallback, and explicit limitations. |
| Tool output becomes a finding. | Agents report a defect because a pattern matched, without reading surrounding source or validating behavior. | Every tool labels output as routing evidence. Docs and skill require source reads and project-native validation before claims. |
| Agents confuse current-source syntax with semantic references. | Same-name functions, methods, fields, or object keys are treated as exact references. | Evidence rows carry source labels such as `tree-sitter:call_expression`, `tree-sitter:member_expression`, `rg` literal fallback, or opt-in provider evidence such as `gopls:references` and `typescript:references`. |
| Broad changed-file diffs starve the root budget. | One large or alphabetically early file consumes all roots, so the map misses other changed subsystems. | Changed-file root selection ranks by signal and spreads roots across changed files within a signal tier. |
| Common interface methods dominate impact maps. | Go methods such as `String`, `Set`, `Error`, `Len`, or `Swap` route to unrelated flag/string/sort call sites. | Low-signal method names rank later; they remain available when the budget is large enough. |
| Tests and fixtures dominate changed-file roots. | A changed test helper can outrank production symbols and drive noisy read-next suggestions. | Non-test files rank before test/spec files; object-literal methods are not root definitions. |
| Agents overuse state/diagnostics as a ritual. | Routine work starts with diagnostics and tool inventory instead of task-relevant context. | `code_intel_state` exists for availability/config/footer debugging. Normal workflows start with `impact_map` or `local_map`. |
| Review delegation loses routing context. | Builtin subagents may not have extension tools, so they review only the prompt or visible diff. | Parent/orchestrator should run maps first and pass candidate files, reasons, and limitations to reviewers. |
| Agents seek exactness too early. | They reach for heavyweight semantic/index tools before knowing whether syntax routing is enough. | Tree-sitter is the fast default. LSP is future opt-in confirmation for high-value exactness cases, not the first step. |
| Index/freshness tooling creates false confidence. | Indexed tools can be stale, write repo artifacts, or require opaque update flows; agents then treat “indexed” as authoritative. | Normal code-intel has no repo-local index. It parses current source and reports bounded evidence. |
| Syntax search becomes broad static analysis. | Agents run wide pattern scans and infer bugs from matches. | `code_intel_syntax_search` requires an explicit shape, stays read-only, and is framed as candidate matching, not linting. |

The desired agent loop is:

1. Identify the change boundary: diff, changed files, root symbols, or local subsystem.
2. Run `code_intel_impact_map` or `code_intel_local_map` for a small read-next queue.
3. Read the returned files and inspect the actual code paths.
4. Use `code_intel_syntax_search` for one narrow shape when the map cannot express it.
5. Use opt-in LSP confirmation only when exact references materially reduce risk.
6. Validate with project-native commands before claiming correctness.

## Current State

Implemented and committed under `agent/extensions/private/code-intelligence/`:

- `code_intel_state`
- `code_intel_impact_map`
- `code_intel_local_map`
- `code_intel_syntax_search`

Current `code_intel_state` also reports status-only availability for `gopls`, Rust Analyzer, and TypeScript tooling. Current `code_intel_impact_map` supports bounded opt-in exact-reference confirmation for returned Go and TypeScript/JavaScript roots.

Current backends:

- `tree-sitter` via `@vscode/tree-sitter-wasm`
- `rg` via ripgrep
- opt-in `gopls` confirmation through short-lived `gopls references` commands
- opt-in TypeScript/JavaScript confirmation through the local TypeScript language service

Current config:

```json
{
  "maxResults": 50,
  "queryTimeoutMs": 30000,
  "maxOutputBytes": 5000000
}
```

Recent validated commits:

- `26ff1f1 refactor: remove legacy code intel backends`
- `96c4fa7 fix: deprioritize generic method roots`
- `845d4bc fix: spread changed-file impact roots`
- `b382b77 fix: suppress method-call selector duplicates`
- `667a539 feat: report language-server availability`
- `bde6072 feat: add opt-in gopls reference confirmation`

Current validation evidence:

```bash
git diff --check
npm --prefix agent/extensions run typecheck
npm --prefix agent/extensions test
./link-into-pi-agent.sh
```

The suite currently passes with 28 tests.

## Evidence Model

All output is routing evidence, not proof.

| Evidence source | Meaning | Limitations |
| --- | --- | --- |
| Tree-sitter | Current-source syntax candidates with file/line locations. Useful for definitions, calls, selectors/member fields, keyed/object-literal fields, and explicit syntax shapes. | Not type-resolved. Same-name methods/fields from unrelated types may appear. Cannot prove complete impact. |
| `rg` | Literal text fallback. Useful for docs/comments/generated text and unsupported-language gaps. | Not semantic. A text match is not a reference. |
| LSP/provider confirmation | Status-only availability plus opt-in `gopls:references` and `typescript:references` rows for exactness confirmation. Future Rust/C#/Python/Bash adapters remain deferred. | Depends on workspace setup, generated files, language-server behavior, and project configuration. Still evidence, not absolute proof. |

Agents must read source before reporting findings or making compatibility claims. Project-native validation remains required for correctness-sensitive changes.

## Desired End State

- Keep the normal tool surface small:
  - `code_intel_state`
  - `code_intel_impact_map`
  - `code_intel_local_map`
  - `code_intel_syntax_search`
- Keep Tree-sitter as the default routing substrate.
- Keep `rg` as bounded literal fallback, clearly separated from Tree-sitter evidence.
- Add language-server support only as explicit exactness confirmation, not as always-on routing.
- Avoid repo-local indexes, background daemons, broad analyzers, automatic rewrites, and auto-installs.
- Keep docs and the companion skill clear that output is advisory read-next evidence.
- Keep parent/orchestrator guidance: run code-intel maps before delegating review unless the subagent is explicitly configured with code-intel tools.

## Non-Goals

- No Cymbal/sqry resurrection as normal backends.
- No ast-grep subprocess path for normal syntax search.
- No broad rule-pack scans by default.
- No automatic rewrites or AST fixes.
- No claim of complete impact analysis.
- No required large-repo-only validation for deterministic tests.
- No long-lived language-server daemon unless a later design justifies lifecycle management.

## Implemented Baseline

### Tree-sitter routing

Implemented files include:

- `agent/extensions/private/code-intelligence/src/tree-sitter.ts`
- `agent/extensions/private/code-intelligence/src/impact.ts`
- `agent/extensions/private/code-intelligence/src/local-map.ts`
- `agent/extensions/private/code-intelligence/src/syntax.ts`
- `agent/extensions/private/code-intelligence/src/state.ts`

Supported language specs currently include Go, TypeScript, TSX, JavaScript, Rust, Python, Java, C/C++, C#, Ruby, PHP, Bash, and CSS.

### `code_intel_impact_map`

Builds candidate read-next maps from explicit `symbols`, `changedFiles`, or `baseRef`.

Current changed-file root tuning:

- non-test files rank before test files
- functions/methods rank before types and fields
- common low-signal method names such as `String`, `Set`, `Error`, `Len`, `Less`, and `Swap` rank later
- object-literal methods are not treated as changed-file root definitions
- root selection spreads across changed files within each signal tier so broad diffs do not exhaust the budget in one file

### `code_intel_local_map`

Combines:

- Tree-sitter current-source impact rows for anchors and names
- optional Tree-sitter selector syntax matches
- bounded `rg` literal fallback

The output includes suggested files, reasons, truncation, and limitations.

### `code_intel_syntax_search`

Runs in-process Tree-sitter search for explicit patterns. Supported convenience forms include:

- `foo($A)`
- `$OBJ.Field`
- `Field: $VALUE`
- wrapper patterns containing those shapes
- raw Tree-sitter S-expression queries with captures

Syntax search is read-only.

### `code_intel_state`

Reports:

- repo root and requested root
- loaded config and config paths
- Tree-sitter availability/version/languages
- `rg` availability/version
- status-only `gopls`, Rust Analyzer, and TypeScript server availability
- limitations and optional diagnostics

### Opt-in reference confirmation

`code_intel_impact_map` accepts `confirmReferences` to run bounded exact-reference checks for returned roots:

- `"gopls"` uses short-lived `gopls references` for Go roots.
- `"typescript"` uses the local TypeScript language service for TypeScript/TSX/JavaScript roots.

The confirmation payload is separate from the Tree-sitter routing rows and includes:

- `basis: "lspExactReferences"`
- provider evidence labels such as `gopls:references` and `typescript:references`
- root and reference caps
- graceful diagnostics when provider tooling or workspace setup fails

This keeps the normal four-tool surface intact while making exactness confirmation explicit and opt-in.

## Ordered Work

### 1. Keep dogfooding Tree-sitter routing quality

Goal: improve read-next usefulness while preserving low operational cost.

Candidate improvements:

- Better local-map section clarity: separate `tree-sitter` structural rows from `rg` literal fallback in summaries and docs.
- Better path scoping defaults for local maps, especially avoiding README/skill/docs unless requested.
- Better handling for interface/object field roots when changed-file mode discovers many fields.
- Better candidate grouping/deduplication for same-line call + selector pairs.
- More concise high-signal summaries for broad diffs.

Acceptance criteria:

- Improvements are backed by small deterministic tests.
- Broad dogfood on promshim or another real repo shows improved routing or reduced noise.
- Tool output remains honest about limitations.

Validation:

```bash
git diff --check
npm --prefix agent/extensions run typecheck
npm --prefix agent/extensions test
./link-into-pi-agent.sh
```

### 2. Dogfood opt-in reference confirmation

Goal: verify that the existing-tool option is useful without making LSP/provider work feel mandatory.

Current decision:

- Keep the four-tool surface unchanged.
- Use `code_intel_impact_map` with provider-specific `confirmReferences` values for bounded confirmation.
- Keep confirmation payload under `referenceConfirmation` so Tree-sitter routing and exactness evidence stay separate.

Acceptance criteria:

- Manual dogfood on promshim for one noisy Go symbol.
- Deterministic TypeScript fixture confirms references without external installs.
- Diagnostics remain graceful when provider tooling, module setup, or workspace metadata fails.
- Docs and skill keep confirmation opt-in.

Validation:

- Small deterministic fake-`gopls` fixture test.
- Small deterministic TypeScript language-service fixture test.
- Manual dogfood on promshim for one noisy symbol.

### 3. Add Rust/C#/Python/Bash exactness only after Go/TypeScript prove useful

Goal: avoid building more adapters before the workflow is validated.

Potential future adapters:

- Rust references/definitions via rust-analyzer.
- C# references/definitions via Roslyn LSP, `csharp-ls`, or OmniSharp depending on local project shape.
- Python references/definitions via Pyright/Jedi/PylSP depending on local availability.
- Bash diagnostics/symbol support via ShellCheck or bash-language-server where useful; exact references may not be worth prioritizing.

Acceptance criteria:

- Go and TypeScript adapters have demonstrated value first.
- Each adapter has bounded output, diagnostics, and source-specific limitations.
- Docs keep Tree-sitter as the default routing substrate.

### 4. Update docs and skill for LSP confirmation workflow

Files:

- `agent/extensions/private/code-intelligence/README.md`
- `agent/extensions/private/code-intelligence/skills/code-intelligence/SKILL.md`
- `agent/agents/impact-reviewer.md` if subagent guidance changes
- review skill support files only if a light mention materially improves behavior

Acceptance criteria:

- Docs explain Tree-sitter vs `rg` vs LSP evidence.
- Skill tells agents when LSP confirmation is worth the cost.
- Parent/orchestrator delegation guidance remains clear.
- Docs do not encourage broad scans or exactness theater.

Validation:

```bash
git diff --check -- agent/extensions/private/code-intelligence agent/agents/impact-reviewer.md agent/skills/review
npm --prefix agent/extensions run typecheck
npm --prefix agent/extensions test
./link-into-pi-agent.sh
```

## Compatibility and Safety

- The four-tool surface is now the stable baseline. Avoid adding new public tools unless dogfood shows a strong workflow reason.
- Do not preserve compatibility with removed Cymbal/sqry/ast-grep/indexing tools; they were private experiments and have been intentionally removed.
- Keep `strictness` in syntax-search parameters only as a compatibility hint for ast-grep-style patterns; the in-process Tree-sitter runner ignores it.
- Keep all new output bounded and include truncation metadata.
- Keep path handling repo-root constrained.
- Do not write repo artifacts for code-intel.

## Final Validation Checklist

For any code-intel change:

```bash
git diff --check
npm --prefix agent/extensions run typecheck
npm --prefix agent/extensions test
./link-into-pi-agent.sh
```

For behavior changes, also perform at least one focused dogfood run, preferably on promshim when the change affects Go routing quality.

Example dogfood areas:

- broad `changedFiles` impact maps on promshim
- scoped local maps around `NeedTags`, `RequiredTagLabels`, or native renderer planner terms
- explicit syntax search for Go selector/keyed-field patterns

Record any new tuning ideas here or in a follow-up plan before implementing them.
