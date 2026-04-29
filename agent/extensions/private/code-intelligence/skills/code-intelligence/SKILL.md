---
name: code-intelligence
description: "Use when preparing a bounded read-next map for non-trivial code review or edits: changed files, exported/shared symbols, handlers, config/schema/protocol code, or scoped subsystem mapping before delegation or broad cross-file navigation."
---

# Code Intelligence

Use `code_intel_*` tools to prepare candidate files and symbols to inspect next. Outputs are routing evidence, not exact references, complete impact, or proof of a defect.

## Core Workflow

1. Start from the task boundary: diff, changed files, base ref, or a small set of root symbols.
2. Run `code_intel_impact_map` for review/edit impact context, or `code_intel_local_map` for a scoped subsystem with anchors plus related names.
3. Use `code_intel_syntax_search` only for explicit current-source shapes the map cannot express.
4. Read the returned files before making findings, edits, or compatibility claims.
5. Run project-native validation when behavior, public contracts, tests, or generated outputs matter.

## Delegating Review

Builtin subagents may not have code-intel tools. Do not assume a reviewer subagent can call them.

Before delegating review, the parent should usually:

1. Inspect the diff or changed files.
2. Run `code_intel_impact_map` with `changedFiles`, `baseRef`, or root `symbols`.
3. Add any scoped `code_intel_syntax_search` results for known risky syntax patterns.
4. Pass the candidate files/reasons and limitations in the reviewer prompt.

Use a custom code-intel-aware reviewer only when it is explicitly configured with the narrow tools it needs.

## Tool Selection

- `code_intel_impact_map`: primary tool. Builds a Tree-sitter current-source candidate read-next map from changed files, root symbols, or a base ref. Rows include evidence such as `syntax_call`, `syntax_selector`, and `syntax_keyed_field`. Use this before non-trivial edits/reviews and before delegating review.
- `code_intel_local_map`: scoped subsystem map. Uses Tree-sitter current-source rows plus bounded literal fallback when you have anchors plus related fields/types/API names and want suggested local files to read.
- `code_intel_syntax_search`: explicit in-process Tree-sitter candidate search. Use supported patterns such as `foo($A)`, `$OBJ.Field`, `Field: $VALUE`, wrapper patterns containing those shapes, or raw Tree-sitter queries with captures.
- `code_intel_state`: inspect Tree-sitter availability, config, footer status, or legacy sqry artifact policy when that matters.
- `code_intel_update`: explicit legacy index refresh; Tree-sitter needs no index and sqry obeys artifact policy.

Low-level tools are secondary:

- `code_intel_references`: refine one specific relationship question only. It is not an exact-reference engine. Rows marked `kind: "text_fallback"` are text-search candidates, not symbol-proven references.
- `code_intel_symbol_context`: quick sketch for one symbol from a map. Caller rows are candidate callsites.
- `code_intel_symbol_source`: focused symbol-source inspection after impact/context is already understood.
- `code_intel_replace_symbol`: experimental guarded edit of one resolved symbol span; avoid unless imports, signature, callers, tests, generated files, and surrounding invariants are irrelevant or already inspected.

## Guardrails

- Treat Tree-sitter output as a read-next queue, not semantic truth. Legacy Cymbal/sqry rows are even less authoritative and should be used only for focused experiments/debugging.
- Do not turn tool output directly into a review finding; inspect current source first.
- Do not use low-level references as a substitute for `gopls`, TypeScript language services, Rust Analyzer, or project-native checks when exact references matter.
- Do not run broad rule scans by default.
- Do not perform rewrites through syntax search.
- Keep result sets bounded. Prefer `detail: "locations"` when files will be read next; use `detail: "snippets"` only for inline triage.
- Use standalone `rg` for comments/docs/generated text, literal fallback beyond caps, or unsupported-language gaps.
- If sqry would create repo-local artifacts, require ignored artifacts or explicit policy approval.
