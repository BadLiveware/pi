# Candidate Backlog After Slice 00

Slice 00 promoted the highest-evidence work into concrete execution files:

- `slices/01-post-edit-summary-boundaries.md`
- `slices/02-diagnostics-timing-trust.md`
- `slices/03-route-ranking-scope-control.md`

This file now tracks deferred candidates only. Promote one into a new slice only when the user reprioritizes it or an earlier slice uncovers it as necessary.

## Deferred Candidate A — Mixed-language and unsupported fallback polish

Feedback signal:

- `promshim-ch` C++/Python impact/post-edit feedback reported no parsed files, missing changed symbols, timeouts, and compensatory manual reads/search.
- ClickHouse C++ impact map feedback reported memory access out-of-bounds or no supported current-source files parsed.

Candidate outcomes:

- Supported and fallback-only changed files are separated in structured details.
- Unsupported files include concrete next-step guidance.
- Compact output includes a concise partial/fallback line rather than implying complete impact coverage.
- Parser/provider errors name affected files and preserve useful fallback rows.

Likely areas after package source-of-truth adoption:

- Standalone impact/post-edit coverage reporting.
- C++/Python/unsupported fixture tests in the standalone package or wrapper package.
- Pi adapter changes only if the package boundary requires integration support.

Promotion trigger:

- User prioritizes promshim/ClickHouse C++ behavior, or Slices 01–03 cannot explain partial results without fallback support.

## Deferred Candidate B — File outline path/error polish

Feedback signal:

- `code_intel_file_outline` on a stale/nonexistent path failed quickly but lacked actionable path-mismatch context.

Candidate outcomes:

- Bad-path errors suggest likely path-base mismatch or nearby candidate paths when cheap and bounded.
- Compact error output remains short.

Likely areas:

- Native path normalization and outline compact error rendering.
- Native tests plus Pi adapter tests if the boundary changes visible Pi behavior.

Promotion trigger:

- More path-base feedback arrives, or standalone/MCP users repeatedly hit cwd/repo path confusion.

## Deferred Candidate C — Packaging sync cleanup

Feedback signal:

- Source-of-truth inspection found the Pi extension package lock records `private/code-intelligence` bin metadata as `src/standalone/cli.ts`, while the Pi extension package manifest declares `./dist/standalone/cli.js`.

Candidate outcomes:

- Package lock and package manifest agree.
- Docs clearly explain whether Pi extension vendoring remains manual or moves to package consumption.

Likely areas:

- `/home/fl/code/personal/pi/agent/extensions/package-lock.json`
- Pi extension package metadata.

Promotion trigger:

- A packaging/build change is already being made, or stale package metadata breaks a validation/publish/link workflow.
