# Code-intel targeted context tools plan

## Purpose

Improve the private code-intelligence extension so agents can get precise code context with fewer broad reads and fewer double reads. The first-class goal is not more source dumping; it is helping the agent perform exactly one useful source read when source is needed, and zero source reads when location evidence is enough.

## Desired end state

- Existing routing tools expose precise, bounded `readHint` data without returning source bodies.
- Locator tools that identify declarations expose a shared `symbolTarget` object in the same shape accepted by the targeted source tool, so agents can pass it through instead of reconstructing symbol identity from prose or line numbers.
- A new targeted source tool can return a complete declaration segment, especially full function/method bodies.
- Optional referenced-definition context can include one-hop local constants, variables, and types when those definitions are needed to understand the target; function/helper expansion is deferred.
- Each result explicitly tells the agent whether source is included, whether it is complete, and whether another read is recommended.
- Post-edit follow-up remains read-only and validation-oriented; code-intel does not become a write or codemod tool.
- Usage logging can measure whether the new surfaces reduce duplicate reads and broad compensatory searches.

## User-stated requirements

- Avoid tools that make the agent read the same source twice.
- For function or method targets, return the full function/method by default when using a source-returning tool.
- Treat `contextLines` as useful mainly for small declarations such as class fields, struct fields, constants, variables, object properties, enum members, comments, attributes, and decorators.
- Add a variable/reference context switch that can include outside definitions when a target references them, such as constants used by a function or variables defined from other variables.
- Make `readHints` usable by agents for highly specific reads.
- Treat write-follow-up tracking as an extension of current code-intel tracking rather than a major new write surface.

## Non-goals

- No direct code-intel write, patch, codemod, or caller-update tool in this plan.
- No semantic claims that Tree-sitter ranges prove exact references or full impact.
- No automatic recursive context expansion without caps.
- No source body in locator-mode outputs unless an explicit source mode is requested.
- No hidden state dependency where a later tool silently depends on the previous result without verifying file hash and range freshness.

## Core product rule: locator mode vs source mode

### Locator mode

Tools in locator mode return paths, ranges, reasons, evidence, and read hints. They do not return source bodies.

Examples:

- `code_intel_file_outline`
- `code_intel_impact_map`
- `code_intel_local_map`
- `code_intel_test_map`
- `code_intel_repo_route`

Locator-mode output should include fields like:

```json
{
  "sourceIncluded": false,
  "sourceCompleteness": "none",
  "nextReadRecommended": true,
  "nextReadReason": "source-not-included",
  "symbolTarget": {
    "path": "src/api.ts",
    "uri": "file:///repo/src/api.ts",
    "source": "tree-sitter",
    "positionEncoding": "utf-16",
    "kind": "function_declaration",
    "name": "fetchWithRetry",
    "containerName": "ApiClient",
    "detail": "fetchWithRetry(options: RetryOptions)",
    "range": { "startLine": 120, "startColumn": 1, "endLine": 180, "endColumn": 2 },
    "selectionRange": { "startLine": 120, "startColumn": 17, "endLine": 120, "endColumn": 31 },
    "targetRef": "stable123",
    "symbolRef": "src/api.ts#function_declaration#ApiClient.fetchWithRetry@stable123",
    "rangeId": "exact456",
    "relocation": { "version": 1, "before": ["opaque-before-anchor"], "after": ["opaque-after-anchor"] }
  },
  "readHint": {
    "path": "src/api.ts",
    "offset": 120,
    "limit": 61,
    "reason": "target declaration range",
    "symbolTarget": "same-object-or-reference"
  }
}
```

A generic `read` after locator mode is not a double read; it is the first source read.

### Source mode

Tools in source mode return bounded source segments. The returned segment is the source read.

Examples:

- proposed `code_intel_read_symbol`
- proposed symbol context mode with referenced definitions
- later caller/test context bundles, if they return source segments

Source-mode output should include fields like:

```json
{
  "sourceIncluded": true,
  "sourceCompleteness": "complete-segment",
  "nextReadRecommended": false,
  "nextReadReason": "complete-target-segment-included"
}
```

A generic `read` of the same range after complete source mode is discouraged unless the segment was truncated, ambiguous, stale, or too narrow for an edit.

## Affected areas

Known affected areas from current repo structure:

- `agent/extensions/private/code-intelligence/index.ts` for tool registration wiring and compact rendering integration.
- `agent/extensions/private/code-intelligence/src/orientation-tools.ts` for existing outline and route tool registration.
- `agent/extensions/private/code-intelligence/src/tree-sitter.ts` for parsed files, symbol records, line ranges, owners, enclosing ranges, and source slicing helpers.
- `agent/extensions/private/code-intelligence/src/types.ts` for shared result contracts.
- `agent/extensions/private/code-intelligence/src/compact-output.ts` for concise output formatting.
- `agent/extensions/private/code-intelligence/src/usage.ts` for invocation and follow-up logging.
- `agent/extensions/private/code-intelligence/README.md` and `skills/code-intelligence/SKILL.md` for agent-facing workflow guidance.
- Existing test files plus new focused tests for symbol ranges, read hints, source completeness, referenced context, and usage follow-up.

Implementation should use vertical slice modules. Prefer adding `src/symbol-context/` for new source-mode behavior instead of adding substantial logic to `index.ts` or `orientation-tools.ts`.

## Execution plan

### Slice 1 — Shared source-range and read contract

Goal: create the common primitives that prevent double reads.

Implementation tasks:

1. Add a small source-range helper module with:
   - line and column range normalization;
   - line-based source slicing;
   - bounded byte and line caps;
   - stable source hash for a file or selected range;
   - range freshness verification from file contents.
2. Add a shared `symbolTarget` contract used by locator outputs and accepted directly by source-mode tools:
   - `path`, `uri`, `language`, `source`, `positionEncoding`, `kind`, `name`, optional `containerName`/`owner`, optional `detail`/`signature`, optional `arity`;
   - normalized full declaration `range` plus identifier `selectionRange` for future LSP position-based operations;
   - `targetRef`/`symbolRef` generated from stable file-local identity fields for compact pass-through targeting;
   - `rangeId` generated from stable identity plus exact declaration range and range hash for freshness validation;
   - opaque relocation hints with independently hashed before/after sibling anchors, kept out of compact output, for stale-target disambiguation after line shifts or nearby insertions;
   - source/range hash metadata for freshness checks.
3. Add shared result metadata fields:
   - `sourceIncluded`;
   - `sourceCompleteness`: `none`, `complete-segment`, `partial`, or `locations-only`;
   - `nextReadRecommended`;
   - `nextReadReason`;
   - `readHint` when source is not included or is partial.
4. Keep these fields concise in model-facing output and richer in structured details.

Acceptance criteria:

- Range helpers reject paths outside repo root.
- Range helpers produce deterministic slices for LF and CRLF files.
- `symbolTarget` is serializable, compact, and can be passed unchanged into `code_intel_read_symbol`.
- Result metadata can be used by multiple tools without each tool inventing its own wording.
- Tests cover complete segment, partial/truncated segment, locations-only cases, and symbol-target round trips.

Validation:

- `cd agent/extensions && npm run typecheck`
- targeted tests for the new range helper module

### Slice 2 — Add locator-mode `symbolTarget` and `readHints` to file outline first

Goal: make the existing outline tool better without adding source bodies or new double-read risk.

Current state: `code_intel_file_outline` and file-tier `code_intel_repo_overview` already expose partial declaration identity (`kind`, `name`, line/column range, optional `owner`, optional `type`, optional `exported`, and optional snippet text). That is useful for navigation, but it is not yet the exact selector shape a future source-mode read tool should accept: it lacks `symbolTarget`, stable `symbolRef`/`rangeId`, source/range hashes, and signature/arity metadata where available.

Implementation tasks:

1. Extend `code_intel_file_outline` declaration rows with a `symbolTarget` object in the shared contract from Slice 1.
2. Extend declaration rows with a `readHint` containing `path`, `offset`, `limit`, range, reason, and the same `symbolTarget` or a reference to it.
3. Add stable `rangeId` or equivalent range token for declarations in outline output.
4. Re-check that outline output remains compact by default and does not include full bodies.
5. Include nested declaration ranges where existing parser records can do this reliably.
6. Use the same declaration row shape in file-tier `code_intel_repo_overview` when declarations are included, while respecting overview caps.

Acceptance criteria:

- `file_outline` can point the agent to the exact declaration range without returning source.
- `file_outline` output marks `sourceIncluded: false` and `sourceCompleteness: "locations-only"` or `"none"`.
- `file_outline` and file-tier `repo_overview` declarations use the same `symbolTarget` shape consumed by `code_intel_read_symbol`.
- A future source-mode tool can consume the same symbol target after verifying file freshness.
- Ambiguous or unsupported declaration ranges are omitted or marked with a limitation rather than guessed.

Validation:

- TypeScript fixture with function, class method, class field, exported const, object method, and nested helper.
- Go fixture with function, method receiver, package constant, and struct field.
- Existing orientation tests still pass.

### Slice 3 — Add `code_intel_read_symbol` as source mode

Goal: provide a true targeted source read that replaces a generic full-file read for one declaration.

Initial API shape:

```json
{
  "repoRoot": "/repo",
  "target": {
    "path": "src/api.ts",
    "kind": "function",
    "name": "fetchWithRetry",
    "containerName": "ApiClient",
    "range": { "startLine": 120, "startColumn": 1, "endLine": 180, "endColumn": 2 },
    "selectionRange": { "startLine": 120, "startColumn": 17, "endLine": 120, "endColumn": 31 },
    "targetRef": "stable123",
    "rangeId": "exact456"
  },
  "contextLines": 0,
  "maxBytes": 30000,
  "detail": "source"
}
```

The tool can support shorthand fields such as `path` + `symbol` for manual use, but the preferred agent flow is pass-through: previous code-intel tools emit `symbolTarget`, and `code_intel_read_symbol` accepts that object directly. This avoids making the agent reconstruct identity from prose, line ranges, or a second scan.

`line` and `column` are not the primary agent workflow. They are a fallback for "read the declaration enclosing this existing location" cases, such as LSP diagnostics, stack traces, compiler errors, or a user pointing at a line.

Implementation tasks:

1. Require `target.path` or `path` for the first implementation to avoid repo-wide same-name ambiguity.
2. Select by one of:
   - exact `target.rangeId` from outline or another code-intel result;
   - stable `target.targetRef`/`symbolRef`, then opaque relocation anchors when line/range data is stale;
   - `target` fields such as `path`, `kind`, `name`, `owner`, range, and `signature`/arity metadata;
   - shorthand `symbol` plus optional `owner`, `kind`, and `signature`/arity metadata;
   - enclosing declaration at `line` and optional `column` only for location-originated workflows.
3. For function-like targets, return the full function/method/constructor body by default.
4. For small declarations, allow `contextLines` to include adjacent comments, decorators, attributes, or enclosing class/struct header when useful.
5. Return alternatives instead of choosing silently when multiple declarations match. Same-file ambiguity is real in languages with overloads, methods on different receivers/classes, nested functions, trait/impl methods, object literal methods, constructors, or duplicate/overload signatures.
6. Return source without synthetic line-number prefixes so it can be copied into `edit.oldText` if needed.

Acceptance criteria:

- Complete function reads set `sourceIncluded: true`, `sourceCompleteness: "complete-segment"`, and `nextReadRecommended: false`.
- Truncated reads set `sourceCompleteness: "partial"`, include omitted counts, and provide a broader `readHint`.
- Ambiguous selection returns alternatives and no arbitrary body.
- File hash or range hash is included so later follow-up can detect staleness.
- Locator outputs expose identifiers that make later source reads possible without asking the agent to rediscover the same symbol by line scanning.

Validation:

- TypeScript tests for exported function, arrow function, class method, field, constant, object method, constructor, and same-name/nested ambiguity.
- Go tests for function, receiver method, const, var, and struct field.
- C#/C++ or fixture-level overload test once those languages are in scope for this tool.
- Path safety tests for absolute outside path and `..` traversal.

### Slice 4 — Add explicit referenced-definition context

Goal: implement the user's variable/context switch in a bounded and explainable way.

API shape option:

```json
{
  "target": {
    "path": "src/api.ts",
    "language": "typescript",
    "kind": "function",
    "name": "fetchWithRetry",
    "owner": "ApiClient",
    "symbolRef": "src/api.ts#function#ApiClient.fetchWithRetry@range-hash"
  },
  "include": [
    "referenced-constants",
    "referenced-vars",
    "referenced-types"
  ],
  "maxContextSegments": 8,
  "maxBytes": 50000
}
```

Implementation tasks:

1. Start with one-hop same-file references only.
2. Limit the first version to constants, variables, and type declarations. Do not include fields/properties or called functions/helpers yet; those have broader context and recursive implications and belong in a later design after the non-recursive context model is proven.
3. Extract identifiers used inside the target range.
4. Match identifiers to same-file declarations by kind and lexical scope.
5. Return extra segments with evidence such as `identifier-used-in-target` and `same-file-declaration`.
6. De-duplicate segments and avoid returning the target body twice.
7. Cap by segment count, total lines, and total bytes.
8. Include omitted counts and reasons when references are skipped, including `function-reference-deferred` for function/helper references that are intentionally out of scope.

Acceptance criteria:

- A function using a module constant can return the full function plus the constant declaration.
- A variable initialized from another variable can return both declarations when the relevant include option is enabled.
- Types are included only when requested.
- Called functions/helpers are not included in the first version; they are reported as deferred references when detected.
- The output states this is lexical/AST context, not a full semantic dependency closure.
- Recursive expansion is not performed in the first version.

Validation:

- TypeScript fixture with constants, variables initialized from variables, type aliases, interfaces, fields/properties that are intentionally deferred, function calls that are deferred, imports, and shadowed identifiers.
- Go fixture with package constants, vars, struct types, fields that are intentionally deferred, helper calls that are deferred, and shadowing.
- Large-context fixture proves caps and omitted counts work.

### Slice 5 — Extend usage logging to measure double-read behavior

Goal: verify whether the new surfaces reduce redundant reading.

Implementation tasks:

1. Log returned source segments in sanitized form:
   - path;
   - range bucket or line range;
   - rank/source kind;
   - source completeness;
   - source hash or short range hash;
   - no raw source.
2. Track follow-up `read` events against returned source segments.
3. Add follow-up categories:
   - `returned-segment-read`;
   - `returned-segment-edit`;
   - `returned-file-read`;
   - `returned-file-edit`;
   - `returned-file-write`;
   - `post-edit-map-after-edit`;
   - `post-edit-map-after-write`.
4. Track built-in `write` in addition to existing `read`, `edit`, search, and test activity.
5. Classify same-range reads after `complete-segment` source mode as likely duplicate reads unless the log can see truncation, staleness, or edit-preparation context.

Acceptance criteria:

- Logs can answer whether `read_symbol` caused or avoided follow-up generic reads of the same range.
- Logs can answer whether `write` touched returned files or segments.
- Logs remain low-cardinality and do not store raw source.

Validation:

- Extend usage follow-up tests for read, edit, write, complete segment, partial segment, and locator-mode read hints.
- Smoke test that feedback state and existing code-intel usage entries still render.

### Slice 6 — Add read-only post-edit follow-up map

Goal: solve the "what should I inspect after editing?" workflow without giving code-intel write authority.

Possible API shape:

```json
{
  "changedFiles": ["src/api.ts"],
  "baseRef": "HEAD~1",
  "includeChangedSymbols": true,
  "includeCallers": true,
  "includeTests": true,
  "includeDiagnostics": true,
  "diagnostics": [
    {
      "path": "src/api.ts",
      "line": 42,
      "column": 17,
      "severity": "error",
      "source": "typescript",
      "code": "TS2345"
    }
  ],
  "avoidReReadingCompleteReturnedSegments": true
}
```

Implementation tasks:

1. Reuse changed-file expansion from `code_intel_impact_map`.
2. Return changed declaration ranges and read hints.
3. Include likely caller/test files as locator-mode results first.
4. Optionally accept or collect LSP/compiler diagnostics when available and cheap. Diagnostics should guide the follow-up map toward declarations enclosing errors/warnings and toward likely validation targets; they should not become auto-fix instructions.
5. Avoid re-suggesting the exact same complete source segment unless the file changed after that segment was produced or a diagnostic now points inside that segment.
6. Include validation hints from `code_intel_test_map`, not auto-run commands.

Acceptance criteria:

- After an edit/write, the tool returns changed symbols, likely impacted files, test candidates, and diagnostic-focused locations when diagnostics are supplied or available.
- It does not encourage rereading complete source already returned before the edit unless freshness has changed or diagnostics make that segment newly relevant.
- It labels unsupported languages, unavailable diagnostics, and non-source files as gaps.
- Diagnostic-driven suggestions are labeled by severity/source/code and remain locator-mode unless the user asks for source mode.

Validation:

- Changed TypeScript fixture with source and tests.
- Changed Go fixture with package function and test file.
- Diagnostic fixture where an error points inside a changed declaration and the post-edit map prioritizes that enclosing symbol.
- Usage test showing `post-edit-map-after-edit` and `post-edit-map-after-write` follow-up categories.

### Slice 7 — Consider caller/test source bundles only after dogfooding

Goal: avoid adding a large source-dumping bundle before we know locator hints and targeted symbol reads are insufficient.

Decision gate:

- Usage logs show repeated sequences of `read_symbol` followed by multiple broad reads of callers/tests.
- Manual dogfooding shows caller/test locator hints are too slow or awkward.
- Output caps and source completeness fields from earlier slices are proven stable.

If approved, implementation should:

1. Return root segment plus a small number of caller/test segments.
2. Group caller/test evidence by enclosing function or test case.
3. Use exact LSP confirmation only when explicitly requested.
4. Maintain the source-mode contract so agents do not re-read the same returned segments.

Acceptance criteria:

- Bundles reduce multiple manual reads in representative Go and TypeScript tasks.
- Output remains bounded by segment count, lines, and bytes.
- Candidate caller/test segments are labeled as routing evidence unless exact confirmation is requested and successful.

## Performance and scale constraints

- Keep source slicing line-based and deterministic.
- Parse only scoped files needed by the request.
- Use total output caps for segments, bytes, and evidence rows.
- Keep referenced-definition expansion one-hop in the first version.
- Avoid persistent caches in this plan; in-memory parse reuse within one tool call is enough.
- Surface truncation and omitted counts instead of silently dropping context.

## Documentation updates

Update `README.md` and the code-intelligence skill with:

- locator mode vs source mode;
- when to use `readHint` with generic `read`;
- when not to generic-read after a complete source segment;
- function targets return complete function bodies;
- `contextLines` is mainly for small declarations and surrounding annotations/comments;
- referenced-definition context is bounded and lexical;
- post-edit map is read-only and validation-oriented.

## Final validation before calling the work done

Run from the repository root unless noted:

```bash
cd agent/extensions && npm run typecheck
cd agent/extensions && npm run check:structure
cd agent/extensions && npm test
cd agent/extensions && npm run eval:code-intel
git diff --check
```

After changing linked agent files, run:

```bash
./link-into-pi-agent.sh
```

Then verify the relevant live symlinks under `~/.pi/agent` still point into this repository.

## Suggested review checkpoints

1. Review after Slice 2 to confirm `readHints` are useful and not noisy.
2. Review after Slice 3 to decide whether `code_intel_read_symbol` should stay path-required or gain repo-wide alternatives mode.
3. Review after Slice 4 to confirm referenced-definition context is useful without causing context explosions.
4. Review usage logs after Slice 5 before implementing caller/test source bundles.

## Preferred implementation order

1. Shared source-range and result contract.
2. Locator-mode read hints on `file_outline`.
3. Path-required `code_intel_read_symbol`.
4. Referenced-definition context options.
5. Usage logging for returned segments and built-in `write`.
6. Read-only post-edit follow-up map.
7. Caller/test source bundles only if measured usage justifies them.
