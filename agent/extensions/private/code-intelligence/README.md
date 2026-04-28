# Pi Code Intelligence

Private local Pi extension for evaluating advisory code-intelligence tools inside Pi.

Use it to gather compact routing evidence: symbol context, references, impact maps, and explicit AST syntax-pattern matches. It does not replace source inspection, compiler/type checks, tests, or project-native validation.

## When to Use It

Use code-intel before falling into repeated `rg`/read navigation when you need to answer concrete relationship questions:

- Who calls or references this function/type/handler?
- Where is this symbol imported, implemented, or used?
- I am editing an unfamiliar exported function, shared helper, handler, config/schema/protocol path, or file touched by a non-trivial diff; which unchanged caller/consumer/test files should I read first?
- Where does this exact AST shape or API call pattern appear?

Commands shaped like `rg -n "func Foo|Foo.*Bar|Bar" src/**/*.go | sed -n ...` are often relationship searches in disguise. Use `code_intel_local_map` first for definitions/callers/usages/fields/API shapes, then use `rg` for literal fallback, generated text, comments/docs, or empty/stale backend results.

Use the returned locations to choose files to read next; do not treat the result as exhaustive proof.

## Backends

| Backend | Used for | Artifact behavior |
| --- | --- | --- |
| Cymbal | symbol context, refs/callers, callees, implementers, importers, impact maps | OS cache per repo by default |
| ast-grep | read-only syntax-pattern search | no index |
| sqry | semantic graph index status/update and future semantic-query experiments | repo-local artifacts such as `.sqry/` |

## Design Rationale

The extension is optimized for agent routing, not replacing source reads or project validation.

| Decision | Rationale |
| --- | --- |
| Role labels (`sem`, `nav`, `ast`) instead of backend-as-fallback wording | sqry, Cymbal, and ast-grep answer different questions; one healthy backend does not make another irrelevant. |
| Auto-index configured role backends on session start | Agents should not need to remember an indexing ritual before using navigation tools. sqry still obeys repo-artifact policy. |
| Keep `includeDiagnostics` opt-in | Normal state checks stay small; detailed runtime logs are for footer errors, stale state, or failed update/debug paths. |
| Default broad nav tools to `detail: "locations"` | Agents usually read/edit returned files next, so inline snippets would duplicate source context. Use `detail: "snippets"` only for triage. |
| Summaries before pagination | `fileCount` and `topFiles` show distribution and hidden breadth without encouraging agents to browse pages mechanically. |
| Compact TUI cards, full structured JSON for the agent | The UI stays readable while agent-facing content remains available for reasoning and follow-up tool calls. |
| Passive usage logs, no agent-facing usage tool | We can evaluate natural adoption without adding a tool that changes normal agent behavior. |

## Why Wrap the CLIs in Pi Tools

Cymbal, ast-grep, and sqry remain the underlying engines. The Pi extension adds value by making them agent-operable:

- **Stable task-level interface:** agents choose `state`, `symbol_source`, `replace_symbol`, `references`, `local_map`, `impact_map`, `syntax_search`, or `update` without learning backend CLI flags.
- **Promptable guardrails:** tool snippets and guidelines teach when to use each lane, when to prefer locations over snippets, and why results are advisory.
- **Context control:** detail modes, grouped summaries, compact command summaries, and TUI cards prevent raw CLI output from filling model and UI context.
- **Operational policy:** sqry artifact checks, auto-indexing, footer status, and runtime diagnostics are handled consistently instead of by ad hoc shell commands.
- **Backend independence:** the agent sees roles (`sem`, `nav`, `ast`) rather than being coupled to a specific CLI or future replacement.
- **Evaluation loop:** passive per-session usage logs let us tune prompts and defaults without adding an agent-facing analytics tool that would bias normal behavior.

Using the CLIs directly is still useful for debugging. The extension exists to make the common agent workflow safer, smaller, and more repeatable.

## Evaluation Notes

- 2026-04-28: In a promshim review session, an agent naturally read the code-intelligence skill, checked state, and used parallel Cymbal reference queries before reading files. This suggests the prompt surface is discoverable.
- 2026-04-28: Micro-action prompt tests on a tiny fixture and `~/code/external/pi-mono` showed agents naturally chose code-intel tools. They initially overused `includeDiagnostics:true`; guidance was tightened so diagnostics are for error/debug paths.
- 2026-04-28: Large-repo testing showed `detail:"locations"` was useful for routing to follow-up reads, reinforcing the default for references and impact maps.

## Footer Status

The extension sets Pi extension status under the key `code-intel`:

- `ci:checking` while probing on session start.
- `ci sem:ok · nav:noidx · ast:ok` style summaries after state checks. `sem` is sqry semantic graph state, `nav` is Cymbal navigation/context state, and `ast` is ast-grep syntax search availability. Backend order follows `backendOrder`, with ast-grep appended for syntax search.
- `ci:idx sem…` or `ci:idx nav…` while auto-indexing or explicit indexing runs.
- `ci:<backend> fail` or `ci:sqry blocked` when an update fails or artifact policy blocks sqry.

Status words: `ok` means available/indexed, `noidx` means available but no index, `stale` means stale, `missing` means the CLI is missing, `blocked` means sqry repo artifacts are not allowed, and `err` means the status probe failed.

Footer-framework can show it by adapting extension status `code-intel`, for example:

```text
/footerfx adapter code-intel status code-intel
/footerfx item code-intel line 2
/footerfx item code-intel zone right
```

Tool results use compact TUI cards: the default view shows a short status/count summary, while expanded rows show bounded file/caller/match details. The full JSON content is still returned to the agent.

This shows active indexing, but not backend-native percent/file progress yet. To show granular progress later, the command runner would need to stream and parse Cymbal/sqry progress output.

## Inspecting Errors

The footer is intentionally compact. To inspect details, call:

```json
{"includeDiagnostics": true}
```

with `code_intel_state`. The diagnostic payload includes `runtimeDiagnostics` with recent auto-index and explicit update operations, the last error for the current repo, and the JSONL log path. Explicit `code_intel_update` calls also return per-backend command summaries directly.

Runtime diagnostics are best-effort: they are written to a small cache log and are meant for local debugging, not as proof of code impact.

## Usage Tracking

The extension passively records low-cardinality local usage metadata to help evaluate whether agents actually use the code-intelligence tools well. It does not register an agent-facing usage-inspection tool by default.

Default log directory:

```text
~/.cache/pi-code-intelligence/usage/
```

Each session writes its own `<session-id>.jsonl` file to avoid contention between concurrent Pi sessions. Set `PI_CODE_INTEL_USAGE_LOG` only when you explicitly want a single-file override for tests/debugging.

Recorded metadata includes tool names, timestamps, repo/cwd, sanitized parameter shapes, result counts/status, duration, coarse adjacent-tool categories such as `read`, `edit`, `bash:search`, or `bash:test`, and same-file `read`/`edit` follow-up events after successful guarded symbol replacements.

Not recorded by default: prompts, full tool outputs, file contents, raw shell commands, raw search queries, raw edit text, raw replacement source, or raw code-intel symbol/query/pattern values.

Use the log manually when evaluating this private extension, for example:

```bash
tail -n 40 ~/.cache/pi-code-intelligence/usage/*.jsonl
```

## Tools

### `code_intel_state`

Inspect backend availability, versions, index status, config paths, and sqry artifact policy.

Use this first when freshness, missing tools, or repo-local artifacts matter. It also refreshes the `code-intel` footer status. Omit `includeDiagnostics` for routine checks; use `includeDiagnostics: true` for footer errors, stale output, or failed auto-index/update commands.

### `code_intel_update`

Explicitly build or refresh indexes.

- `backend: "auto"` updates all configured indexed role backends, normally sqry and Cymbal.
- `backend: "cymbal"` runs `cymbal index .`.
- `backend: "ast-grep"` reports that no index is required.
- `backend: "sqry"` refuses repo-local artifacts unless policy allows them.

During indexing, the `code-intel` footer status switches to `ci:idx <role>…` until the command finishes.

sqry artifact policy:

- `never` — never create repo-local artifacts.
- `ifIgnored` — allow when core sqry index directories are git-ignored.
- `always` — allow explicitly.

### `code_intel_symbol_context`

Return Cymbal-backed definition/source/caller context for one symbol.

Good for: unfamiliar functions, classes/types, handlers, and changed public symbols.

### `code_intel_symbol_source`

Resolve one symbol and return only its source span, relative file, start/end lines, source hash, and replacement preconditions.

Good for large files when the intended inspection is focused on one function, method, type, or variable. If the symbol is ambiguous, pass `file` or `paths`. This is a focused read, not a substitute for callers/imports/surrounding invariants when those matter.

### `code_intel_replace_symbol`

Experimentally replace exactly one symbol span using preconditions returned by `code_intel_symbol_source`.

Use only for narrow symbol-local edits where surrounding context is already understood or irrelevant. Do **not** use for signature changes, import changes, multi-symbol refactors, caller/test updates, generated files, or public contract changes whose callers were not inspected.

The tool:

1. re-resolves the current symbol,
2. verifies file/range/hash preconditions,
3. replaces only that source span under Pi's file mutation queue,
4. re-resolves the symbol after writing,
5. reverts the file if the replacement does not resolve as exactly the requested symbol span.

Success means "the guarded edit landed," not "the code is valid or complete." Run project-native validation and fall back to normal `read` + `edit` when imports, adjacent declarations, or callers matter.

Passive usage logs record sanitized follow-up signals for this experiment, including whether a same-file `read` or normal `edit` happens within a small window after a successful symbol replacement. Source text is not logged; hashes and line/byte counts are used instead.

### `code_intel_references`

Return Cymbal-backed relationship rows. Results include a `summary` section with returned-row `fileCount` and `topFiles` so agents can see distribution before reading files.

Use `detail: "locations"` (default) when returned files are likely read/edit targets. Use `detail: "snippets"` when small inline context is useful before deciding whether to read.

Relations:

- `refs` / `callers`
- `callees`
- `impact`
- `implementers`
- `implementedBy`
- `importers`

### `code_intel_local_map`

Build a scoped local implementation map from central anchors plus related names. This is the convenience tool for replacing compound relationship-search commands such as:

```bash
rg -n "func lowerAggregation|aggregation.*RequiredTagLabels|RequiredTagLabels" internal/promshim/native/renderer/aggregation* internal/promshim/native/renderer/lower*.go
```

Example:

```json
{
  "anchors": ["lowerAggregation"],
  "names": ["RequiredTagLabels"],
  "paths": ["internal/promshim/native/renderer"],
  "language": "go",
  "detail": "locations"
}
```

The tool combines symbol context, references, optional selector syntax matches like `$X.RequiredTagLabels`, and bounded literal fallback, then returns suggested files to read next. Use standalone `rg` afterward for comments/docs, generated text beyond the returned cap, or empty/stale backend results.

### `code_intel_impact_map`

Build a compact impact map from:

- explicit `symbols`
- `changedFiles` expanded through Cymbal `outline`
- optional `baseRef` using `git diff --name-only <baseRef> --`

The output groups roots and related caller rows, with truncation and limitation metadata. Defaults are intentionally tighter than other nav queries: up to 20 root symbols after changed-file expansion and 25 related rows unless overridden. `detail: "locations"` is the default so impact maps route agents to files without duplicating source context. Use `detail: "snippets"` only when inline context helps triage without immediate reads. Returned impact rows omit absolute paths and cap context text; use `repoRoot` plus relative `file` paths for follow-up reads. The `summary` section reports related-file distribution (`relatedFileCount`, `topRelatedFiles`) so hidden breadth is visible without paging.

### `code_intel_syntax_search`

Run read-only ast-grep search for an explicit pattern. Results include a `summary` over all parsed matches, including `fileCount`, `topFiles`, and `returnedFileCount`.

`detail: "snippets"` is the default because syntax matches often need the matched text to judge relevance. Use `detail: "locations"` when matches are just read/edit targets.

Example:

```json
{
  "pattern": "authenticate($A)",
  "language": "ts",
  "paths": ["src/"],
  "maxResults": 25,
  "detail": "locations"
}
```

The extension never passes rewrite/update flags to ast-grep.

## Evidence Model

Treat every result as advisory routing evidence:

- Good: “these files/callers/syntax matches are worth inspecting.”
- Not enough: “therefore this is definitely broken” or “there are no other impacts.”

Before reporting a review finding or claiming a fix is complete, verify the relevant source and run appropriate project-native checks.

## Config

Optional config files:

- user: `~/.pi/agent/code-intelligence.json`
- project: `.pi/code-intelligence.json`

Project config overlays user config.

Defaults:

```json
{
  "backendOrder": ["cymbal", "sqry"],
  "autoIndexOnSessionStart": true,
  "autoIndexBackends": ["sqry", "cymbal"],
  "allowRepoArtifacts": "ifIgnored",
  "maxResults": 50,
  "queryTimeoutMs": 30000,
  "indexTimeoutMs": 300000,
  "maxOutputBytes": 5000000
}
```

## Validation

Focused extension tests use small temp repos for determinism:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/code-intelligence/index.test.ts
```

Large repositories under `~/code/external/` are useful for manual smoke and usefulness checks, but not required for deterministic tests.
