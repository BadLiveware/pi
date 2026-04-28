---
name: code-intelligence
description: "Use before cross-file code navigation in non-trivial repos: finding callers/usages/importers/implementers of a symbol, checking what code reads/calls an edited function/type/file, editing unfamiliar exported functions/handlers/config/schema/protocol code, or when you would otherwise run broad rg/read loops to chase relationships."
---

# Code Intelligence

Use `code_intel_*` tools to find likely files, symbols, and syntax matches to inspect next. Outputs are advisory routing evidence, not proof of complete impact or a real defect.

## Trigger Examples

Use this skill before the second broad `rg`/read loop when you are trying to answer:

- "Who calls this function/type/handler?"
- "Where is this symbol imported, implemented, or referenced?"
- "If I edit this exported function, config/schema/protocol helper, or shared type, which unchanged files should I read next?"
- "What callers or tests might break if I change this behavior?"
- "Where does this exact AST shape/API call pattern appear?"

Also use it before commands shaped like relationship search, for example `rg -n "func Foo|Foo.*Bar|Bar" src/**/*.go | sed -n ...`, when the goal is to understand definitions, callers, usages, fields, or API shapes. Use `rg` afterward for literal fallback, generated text, comments/docs, or when code-intel returns empty/stale results.

## Workflow

1. Call `code_intel_state` when backend availability, freshness, footer status, or sqry artifact policy matters. Omit `includeDiagnostics` for normal checks; use it only for errors or stale/unexpected state.
2. Before editing an unfamiliar function/type/class/handler, use `code_intel_symbol_context` for its definition and nearby callers.
3. Use `code_intel_symbol_source` when you need only one symbol's exact source span, especially in a large file.
4. Use `code_intel_replace_symbol` only after `code_intel_symbol_source`, and only for a narrow symbol-local edit whose imports, signature, callers, and surrounding invariants do not need file-level edits.
5. When you know a symbol/type/file/package name and need callers/usages/importers/implementers, use `code_intel_references` before broad `rg`.
6. When you have an implementation anchor plus related field/type names in a local subsystem, use `code_intel_local_map` instead of composing a multi-name `rg` command.
7. When a diff or planned edit touches exported functions, handlers, config/schema/protocol behavior, shared helpers, or multiple files, use `code_intel_impact_map` to list likely unchanged caller/consumer files to read next.
8. For exact syntax shapes, use `code_intel_syntax_search` with a narrow explicit pattern and scoped paths.
9. Use `detail: "locations"` when you expect to read or edit returned files next; use `detail: "snippets"` only when inline context helps triage.
10. Verify important candidates by reading current source files and running project-native validation when relevant.

## Tool Selection

- `code_intel_symbol_context`: source, callers, imports, and alternate matches for one symbol.
- `code_intel_symbol_source`: exact source span, file/range, and hash preconditions for one resolved symbol.
- `code_intel_replace_symbol`: experimental guarded replacement of exactly one symbol span; avoid for signature/import/caller/multi-symbol/generated-file changes or unknown surrounding invariants.
- `code_intel_references`: refs/callers, callees, impact rows, implementers, implemented interfaces, or importers.
- `code_intel_local_map`: local implementation map for anchor names plus related symbol/field/API names in scoped paths; combines code-intel candidates with bounded literal fallback before you resort to compound relationship-search `rg` commands.
- `code_intel_impact_map`: roots from symbols, changed files, or a git base ref, plus related caller rows.
- `code_intel_syntax_search`: read-only ast-grep candidate search for explicit AST patterns.
- `code_intel_update`: explicit index refresh; sqry obeys artifact policy and the footer status shows active indexing.

## Guardrails

- Do not turn tool output directly into a review finding; inspect source first.
- Do not run broad rule scans by default.
- Do not perform rewrites through syntax search.
- Do not use `code_intel_replace_symbol` to avoid necessary context; if imports, adjacent declarations, callers, tests, or public contracts matter, read/edit files normally.
- Keep result sets bounded and follow up with focused reads.
- If sqry would create repo-local artifacts, require ignored artifacts or explicit policy approval.
- Footer-framework can display this extension through extension status key `code-intel`; keep it compact because it updates on state/index operations.
