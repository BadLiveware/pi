---
name: code-intelligence
description: "Use when a task can benefit from local routing evidence: symbol context, references/callers/callees, impact maps, importers, implementers, or explicit AST syntax-pattern search."
---

# Code Intelligence

Use `code_intel_*` tools to find likely files, symbols, and syntax matches to inspect next. Outputs are advisory routing evidence, not proof of complete impact or a real defect.

## Workflow

1. Call `code_intel_state` when backend availability, freshness, footer status, or sqry artifact policy matters. Omit `includeDiagnostics` for normal checks; use it only for errors or stale/unexpected state.
2. For unfamiliar or changed symbols, use `code_intel_symbol_context`.
3. For cross-file impact, use `code_intel_references` or `code_intel_impact_map`.
4. For exact syntax shapes, use `code_intel_syntax_search` with a narrow explicit pattern and scoped paths.
5. Use `detail: "locations"` when you expect to read or edit returned files next; use `detail: "snippets"` only when inline context helps triage.
6. Verify important candidates by reading current source files and running project-native validation when relevant.

## Tool Selection

- `code_intel_symbol_context`: source, callers, imports, and alternate matches for one symbol.
- `code_intel_references`: refs/callers, callees, impact rows, implementers, implemented interfaces, or importers.
- `code_intel_impact_map`: roots from symbols, changed files, or a git base ref, plus related caller rows.
- `code_intel_syntax_search`: read-only ast-grep candidate search for explicit AST patterns.
- `code_intel_update`: explicit index refresh; sqry obeys artifact policy and the footer status shows active indexing.

## Guardrails

- Do not turn tool output directly into a review finding; inspect source first.
- Do not run broad rule scans by default.
- Do not perform rewrites through syntax search.
- Keep result sets bounded and follow up with focused reads.
- If sqry would create repo-local artifacts, require ignored artifacts or explicit policy approval.
- Footer-framework can display this extension through extension status key `code-intel`; keep it compact because it updates on state/index operations.
