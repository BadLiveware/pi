# Code-intel repo orientation plan

## Purpose

Add deterministic repository-orientation tools to code-intelligence so agents can understand large repositories by reading bounded structure and symbol outlines instead of starting with global `rg`, broad `find`, or whole-repo Tree-sitter scans.

ClickHouse (`/home/fl/code/external/ClickHouse`) is the scale target: whole-repo output must stay useful when a repo has tens of thousands of source/test files and many generated, vendor, build, or external dependency trees.

## Desired end state

Code-intelligence exposes a progressive orientation ladder:

1. **Repo shape**: summarize top-level and scoped directory structure with counts and dominant languages.
2. **Directory overview**: for an explicitly scoped subtree, list files plus top-level declarations/exports in those files.
3. **File outline**: for one file, list language-native declarations such as imports/includes, namespaces/packages/modules, classes/types, functions/methods, variables/constants, and line ranges.
4. **Related test candidates**: for one file and optional symbol/name hints, return likely test files with evidence from paths, names, literals, syntax, and optional exact-reference providers.

The output should present objective repository facts only: paths, language IDs, file counts, declaration names/kinds, line ranges, and evidence. Do not add model-generated summaries or heuristic semantic role labels such as “extension registration”; agents infer meaning from names and structure.

## Scope

### In scope

- Add new read-only code-intel tool surfaces for repo orientation and file outlines.
- Reuse the existing Tree-sitter WASM language layer where possible.
- Support large-repo bounded defaults and explicit scoping.
- Support at least TypeScript/TSX/JavaScript, Go, Python, and C/C++ outlines with graceful fallback for unsupported languages.
- Add test-candidate mapping that works for code tests and non-code tests such as ClickHouse SQL stateless/integration tests.
- Update README and `skills/code-intelligence/SKILL.md` with when to use the new tools.
- Validate against small fixture repos and live ClickHouse smoke checks.

### Non-goals

- No model-generated file or architecture summaries.
- No persistent repo index in the first implementation.
- No repo writes or generated cache files unless a later explicit cache design is accepted.
- No claim that relation/test candidates are exhaustive.
- No replacement for reading source, running tests, or opt-in exact reference confirmation.

## Current implementation facts

- Extension entrypoint: `agent/extensions/private/code-intelligence/index.ts`.
- Current tools: `code_intel_state`, `code_intel_impact_map`, `code_intel_local_map`, `code_intel_syntax_search`.
- Tree-sitter parsing and definition extraction live in `src/tree-sitter.ts`.
- Shared language specs now live in `src/languages.ts`.
- Impact support currently recognizes Go, TypeScript/TSX, JavaScript, Python, and C/C++.
- Reference confirmation is provider-based under `src/lsp/` with `gopls`, `typescript`, and `clangd`.
- Existing validation entry points:
  - `cd agent/extensions && npm run typecheck`
  - `cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/*.test.ts`
  - `cd agent/extensions && npm run check:structure`

## Design principles

- **Progressive disclosure**: broad calls show coarse directory shape; detailed declarations require explicit path scope or a single file.
- **Large-repo first**: defaults must be safe for ClickHouse-scale repos.
- **Facts over interpretation**: no role hints, no model prose, no architecture labels.
- **Evidence labels**: relation/test candidates show why they were returned, e.g. `path_basename`, `literal_match`, `syntax_reference`, `lsp_reference`.
- **Truncation is explicit**: every capped result reports caps, returned counts, and omitted counts where feasible.
- **Unsupported paths are still useful**: non-source, generated, and unsupported files appear as counts and path entries where relevant, not parser failures.
- **Read-only**: tools do not mutate the repository.

## Proposed tools

### `code_intel_repo_overview`

Purpose: answer “what exists here?” without reading every file.

Parameters:

```ts
{
  repoRoot?: string;
  paths?: string[];              // default ["."]
  tier?: "shape" | "files";     // default "shape"
  maxDepth?: number;             // default 2 for shape, 3 for files
  maxDirs?: number;              // default bounded, e.g. 200
  maxFilesPerDir?: number;       // default 0 for shape, 80 for files
  maxSymbolsPerFile?: number;    // default 8 for files
  includeGlobs?: string[];
  excludeGlobs?: string[];
  includeGenerated?: boolean;    // default false
  includeVendor?: boolean;       // default false
  timeoutMs?: number;
}
```

Tier `shape` output:

```jsonc
{
  "ok": true,
  "repoRoot": "/home/fl/code/external/ClickHouse",
  "tier": "shape",
  "roots": ["."],
  "tree": [
    {
      "path": "src",
      "dirs": 120,
      "files": 18000,
      "sourceFiles": 15000,
      "testFiles": 0,
      "dominantLanguages": [{ "language": "cpp", "files": 12000 }, { "language": "c", "files": 2000 }],
      "truncated": true
    }
  ],
  "summary": { "dirCount": 200, "fileCount": 52000, "sourceFileCount": 30000 },
  "coverage": { "maxDepth": 2, "maxDirs": 200, "truncated": true, "excludedDirs": [".git", "build_debug", "contrib"] },
  "limitations": ["Directory shape is file-system evidence only; request tier:'files' or code_intel_file_outline for declarations."]
}
```

Tier `files` output for scoped paths:

```jsonc
{
  "ok": true,
  "tier": "files",
  "roots": ["src/Storages/System"],
  "directories": [
    {
      "path": "src/Storages/System",
      "files": [
        {
          "path": "src/Storages/System/StorageSystemTables.cpp",
          "language": "cpp",
          "declarations": [
            { "kind": "class", "name": "StorageSystemTables", "line": 163, "endLine": 244 },
            { "kind": "class", "name": "TablesBlockSource", "line": 58, "endLine": 146 },
            { "kind": "function", "name": "createVirtuals", "line": 969, "endLine": 977 }
          ],
          "truncated": false
        }
      ],
      "truncated": false
    }
  ]
}
```

### `code_intel_file_outline`

Purpose: answer “what is inside this file?” before reading the whole file.

Parameters:

```ts
{
  repoRoot?: string;
  path: string;
  includeImports?: boolean;      // default true
  includeNonExported?: boolean;  // default true for non-TS languages; TS default true but marks exported
  maxSymbols?: number;           // default 250
  timeoutMs?: number;
  detail?: "locations" | "snippets"; // default locations
}
```

Output:

```jsonc
{
  "ok": true,
  "file": "agent/extensions/private/stardock/src/workflow-status.ts",
  "language": "typescript",
  "imports": ["./completion-policy.ts", "./policy.ts", "./state/core.ts"],
  "declarations": [
    { "kind": "type", "name": "WorkflowState", "exported": true, "line": 14, "endLine": 14 },
    { "kind": "interface", "name": "WorkflowStatus", "exported": true, "line": 21, "endLine": 27 },
    { "kind": "function", "name": "evaluateWorkflowStatus", "exported": true, "line": 55, "endLine": 135 }
  ],
  "summary": { "declarationCount": 8, "importCount": 4 },
  "coverage": { "truncated": false, "maxSymbols": 250 }
}
```

### `code_intel_test_map`

Purpose: answer “which tests likely exercise this file or symbol?”

Parameters:

```ts
{
  repoRoot?: string;
  path?: string;
  symbols?: string[];
  names?: string[];              // domain/public strings such as "system.tables"
  testPaths?: string[];          // optional explicit test dirs
  maxResults?: number;           // default 50
  maxLiteralMatches?: number;    // cap per term
  confirmReferences?: "gopls" | "typescript" | "clangd";
  timeoutMs?: number;
  detail?: "locations" | "snippets";
}
```

Evidence layers:

1. Path/name similarity:
   - same basename or snake/kebab variants
   - mirrored source/test path segments
   - nearby `test`, `tests`, `__tests__`, `gtest`, `integration`, `queries`, `stateless` directories
2. Literal matches in test paths:
   - file stem tokens
   - provided `symbols`
   - provided `names`
3. Syntax matches in supported test source files when cheap.
4. Optional exact references through existing providers when the provider applies.

Output:

```jsonc
{
  "ok": true,
  "target": { "path": "src/Storages/System/StorageSystemTables.cpp", "symbols": ["StorageSystemTables"] },
  "candidates": [
    {
      "file": "tests/queries/0_stateless/00000_system_tables.sql",
      "score": 12,
      "evidence": [
        { "kind": "path_term", "term": "system_tables" },
        { "kind": "literal_match", "term": "system.tables", "line": 3 }
      ]
    }
  ],
  "summary": { "candidateCount": 12, "returnedCount": 12, "testRootsSearched": ["tests"] },
  "coverage": { "truncated": false, "maxResults": 50 }
}
```

## Implementation slices

### Slice 1: shared repository scanner and language classification

Goal: create reusable, bounded filesystem traversal for orientation and test mapping.

Files / areas:
- `src/orientation/repo-scan.ts` or `src/repo-overview.ts`
- `src/languages.ts`
- `src/types.ts`
- focused tests under `private/code-intelligence/*overview*.test.ts`

Tasks:
- Add traversal that accepts repo root, safe repo-relative paths, max depth, max dirs/files, include/exclude globs, timeout, and abort signal.
- Classify files using `LANGUAGE_SPECS` extensions plus source/test/doc/config buckets.
- Exclude `.git`, build directories, dependency/vendor directories, generated-looking directories by default; expose excluded counts.
- Return deterministic sorted entries.
- Validate on fixture repo with nested source/tests/vendor/build dirs.

Acceptance criteria:
- Shape overview can summarize a fixture repo without parsing source.
- Traversal stops at caps and reports truncation.
- Paths outside repo are rejected.
- Abort/timeout returns graceful diagnostics, not partial unsafe state.

Validation:
- `cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/*overview*.test.ts`
- `cd agent/extensions && npm run typecheck`

### Slice 2: language-neutral declaration outline extraction

Goal: expose a reusable file-outline extractor using Tree-sitter declarations.

Files / areas:
- `src/orientation/outline.ts`
- refactor/decompose declaration helpers currently embedded in `src/tree-sitter.ts`
- tests for TS, Go, Python, and C++ outlines

Tasks:
- Extract top-level declaration logic into reusable functions without changing existing impact-map behavior.
- For TypeScript/TSX/JavaScript: imports, exported functions/classes/interfaces/types/consts, non-exported top-level symbols when requested.
- For Go: package, imports, funcs, methods, types, vars/consts.
- For Python: imports, classes, functions, module assignments/constants where easy.
- For C/C++: includes, namespaces, classes/structs, methods, free functions, enum/type aliases, statics where easy.
- Preserve line/endLine/columns and `exported` where meaningful.
- Return unsupported-language diagnostics instead of failing the tool.

Acceptance criteria:
- `code_intel_file_outline` can outline representative fixture files in each target language.
- `code_intel_repo_overview({ tier:'files' })` can include capped declaration summaries per file.
- Existing `impact_map`, `local_map`, and `syntax_search` tests still pass.

Validation:
- targeted outline tests
- existing `private/code-intelligence/*.test.ts`
- ClickHouse smoke: outline `src/Storages/System/StorageSystemTables.cpp` and confirm known declarations appear.

### Slice 3: register `repo_overview` and `file_outline` tools

Goal: make the first two orientation tiers available in Pi.

Files / areas:
- `index.ts`
- `src/types.ts`
- `README.md`
- `skills/code-intelligence/SKILL.md`
- rendering helpers if needed

Tasks:
- Add schemas and prompt guidelines for `code_intel_repo_overview` and `code_intel_file_outline`.
- Keep TUI render compact: show counts and top paths; full JSON remains agent-facing.
- Document large-repo workflow: shape first, then scoped files, then file outline.
- Avoid language suggesting semantic summaries or role hints.

Acceptance criteria:
- Tools register and return structured JSON.
- README and skill explain when to choose overview/outline versus impact/local/syntax.
- Large-repo defaults do not attempt whole-repo declaration parsing.

Validation:
- `cd agent/extensions && npm run typecheck`
- registration test updated to expect new tools
- structure check

### Slice 4: related-test candidate map

Goal: add test discovery for a scoped file/symbol without broad unbounded searching.

Files / areas:
- `src/orientation/test-map.ts`
- `src/rg.ts` or existing exec/literal utilities if present
- `src/lsp/confirmation.ts` reuse for optional exact refs
- tests for code tests and non-code tests

Tasks:
- Discover likely test roots from common names and repo config where cheap: `test`, `tests`, `__tests__`, `spec`, `integration`, `programs/*/tests`, ClickHouse `tests/queries`, `tests/integration`.
- Build search terms from file stem tokens, path segments, symbols, and user-supplied names.
- Rank candidate test files using additive evidence, not prose labels.
- Use bounded `rg` only inside discovered or user-provided test paths, with caps per term.
- Optionally merge LSP reference-confirmation rows for source-code tests where requested.
- Return evidence with line numbers for literal/syntax matches.

Acceptance criteria:
- Finds fixture tests by basename, mirrored path, and literal symbol/name matches.
- Works for SQL/text test files, not just code tests.
- ClickHouse smoke with `StorageSystemTables.cpp` returns plausible `tests/queries` or integration candidates when given `names: ['system.tables']` or symbol/name terms.
- Caps and truncation are visible.

Validation:
- targeted test-map tests
- live ClickHouse smoke with bounded `timeoutMs` and `maxResults`
- existing code-intel test suite

### Slice 5: performance hardening and dogfood pass

Goal: confirm defaults are safe and useful on ClickHouse-scale repositories.

Tasks:
- Run timed smoke checks:
  - shape overview at ClickHouse root
  - file-tier overview for `src/Storages/System`
  - file outline for `src/Storages/System/StorageSystemTables.cpp`
  - test map for the same file with bounded names/symbols
- Inspect output for size, truncation clarity, and usefulness.
- Tune default caps and excluded dirs based on evidence.
- Record dogfood notes in README evaluation notes or a plan evidence section if execution uses Stardock.

Acceptance criteria:
- Shape overview finishes quickly enough for normal agent use on ClickHouse.
- Scoped directory overview does not parse unrelated ClickHouse directories.
- File outline surfaces useful C++ declarations without requiring clangd.
- Test map gives evidence-ranked candidates and does not scan build/contrib/vendor trees.

Validation:
- `git diff --check -- agent/extensions/private/code-intelligence`
- `cd agent/extensions && npm run typecheck`
- `cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/*.test.ts`
- `cd agent/extensions && npm run check:structure`
- Manual ClickHouse smoke commands through live tools after reload.

## Performance shape

Scaling variables:
- number of directories visited
- number of files classified
- number of files parsed by Tree-sitter
- number of literal search terms and test files searched
- maximum output rows and JSON size

Bounds:
- Whole-repo `shape` should classify paths and aggregate counts, not parse symbols.
- `files` tier should require explicit scoped `paths` for declaration extraction; if called at repo root, cap aggressively and report truncation.
- File outline parses exactly one file.
- Test map searches only discovered/user-supplied test roots and caps matches per term.
- All tools respect `timeoutMs` and abort signals.

Representative large-repo validation:
- ClickHouse root `shape` overview.
- `src/Storages/System` `files` tier.
- `StorageSystemTables.cpp` file outline.
- bounded test map with `names: ['system.tables']`.

## Risks and mitigations

- **Output too large**: strict caps, defaults aimed at routing, compact TUI, full JSON only for agent.
- **C++ outline quality uneven**: keep declaration kinds conservative; add tests for constructors/destructors/method definitions over time.
- **Test map noisy**: evidence scoring and required scoping/caps; show evidence so agents can judge.
- **Large repo traversal latency**: shape tier avoids parsing; default excludes build/vendor/contrib; timeout diagnostics.
- **Agents over-trust overview**: README/skill state that orientation is navigation evidence only.

## Suggested commit boundaries

1. `feat: add repo shape scanner for code-intel`
2. `feat: add code-intel file outlines`
3. `feat: expose repo overview tools`
4. `feat: map related tests in code-intel`
5. `docs/test: dogfood repo orientation on ClickHouse` if dogfood tuning is substantial

## Stardock execution fit

If executed with Stardock checklist mode, use one active brief per implementation slice. Promote only the active slice criteria into the ledger. Suggested criteria:

- Repo shape overview is bounded and reports truncation on large repos.
- File outline reports language-native declarations for TS/Go/Python/C++.
- Repo overview files tier uses explicit path scope and capped symbol extraction.
- Test map returns evidence-ranked test candidates including non-code tests.
- Docs and skill guidance describe deterministic orientation without model summaries.
- ClickHouse dogfood passes under bounded caps.
