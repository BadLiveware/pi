# Code-intel Feedback Matrix

## Collection summary

Slice 00 inspected recent `tool-feedback:agent-feedback` session entries and `~/.cache/pi-tool-feedback/*.jsonl` summaries for watched `code_intel_*` tools.

Observed unique feedback records in session logs: 153.

Aggregate signal:

| Field | Main counts |
| --- | --- |
| perceived usefulness | high 81, medium 61, low 8, none 2 |
| requested improvement | better_summary 78, better_ranking 29, other 25, less_noise 17, faster 2, higher_cap 1, better_docs 1 |
| most common primary tool | `code_intel_post_edit_map` when a primary was named |
| configured ranking quality | good 46, mixed 16, unknown 3 among records with field responses |
| configured query fit | good 62, too_narrow 2, too_broad 1 among records with field responses |

Interpretation: code-intel is useful overall, but the feedback strongly supports improving summary/actionability first, then ranking/noise, diagnostics trust, and fallback behavior.

## Selected issues

### CI-FB-001 — Post-edit compact output hides the next action

| Field | Value |
| --- | --- |
| Evidence | 2026-05-20, repo `/home/fl/code/personal/pi`, `code_intel_post_edit_map`, note hash `2c0e7d3e6ba82230` |
| Feedback | Medium usefulness; output noisy; ranking mixed; truncation minor; note says visible output emphasized many low-level changed fields before actionable related/test follow-up. |
| Issue class | Noisy result; summary/actionability gap. |
| Suspected module | reusable `src/slices/post-edit-map/compact.ts`; possibly reusable `runPostEditMap` summary fields. |
| Candidate fixture | Compact-output test with changed symbols, related rows, tests, and diagnostics; assert actionable lines precede low-level declaration rows. |
| Priority | P0 |

### CI-FB-002 — Broad C# project-boundary post-edit map is low signal

| Field | Value |
| --- | --- |
| Evidence | 2026-06-06, repo `/home/fl/code/personal/claude-cloud-agents`, `code_intel_post_edit_map`, note hash `07445c7665dda332` |
| Feedback | Low usefulness; incomplete; note says broad C# project-boundary extraction returned `changed=0 related=0 tests=31` despite many changed `.cs` and `.csproj` files. |
| Issue class | Empty or low-signal result; project-boundary/non-symbol changed-file gap. |
| Suspected module | reusable `src/slices/targeted-symbols/run.ts` post-edit flow; C#/project-file classification; compact output. |
| Candidate fixture | C# fixture with `.cs`, `.csproj`, and test-like files passed to `code_intel_post_edit_map`; assert boundary files are represented, empty-symbol cause is explained, and bounded source/test validation hints appear. |
| Priority | P0 |

### CI-FB-003 — Post-edit diagnostics can be noisy relative to project validation

| Field | Value |
| --- | --- |
| Evidence | 2026-05-18 to 2026-05-20, repo `/home/fl/code/personal/pi`, representative note hashes `25e3265b7497319c`, `36106314bd3121bb`, `b4cb3f66a4afd67e` |
| Feedback | Medium usefulness; noisy diagnostics; notes mention false-positive or misleading TypeScript diagnostics such as TS6059/TS5097 or content-script symbols after project typecheck/build passed. |
| Issue class | Diagnostic trust/freshness ambiguity; noisy result. |
| Suspected module | reusable diagnostics normalization/providers; Pi diagnostic surface hook and compact rendering. |
| Candidate fixture | Supplied plus collected diagnostics with provenance/freshness fields; compact output distinguishes collected/supplied/unknown-freshness rows and does not overstate proof. |
| Priority | P1 |

### CI-FB-004 — Slow/terse post-edit output does not affect validation decisions

| Field | Value |
| --- | --- |
| Evidence | 2026-05-20, repo `/home/fl/code/personal/promshim-ch`, `code_intel_post_edit_map`, note hash `7f6b35d2c650e8a8` |
| Feedback | Low usefulness; incomplete; latency unacceptable; note says scoped post-edit map took about 47s and surfaced only a terse visible summary. |
| Issue class | Slow result; summary/actionability gap; partial-result gap. |
| Suspected module | reusable `runPostEditMap` phase execution and timing metadata; compact output. |
| Candidate fixture | Unit-level fake/controlled timing metadata and compact output that names slow phases only when useful; no wall-clock sleeps. |
| Priority | P1 |

### CI-FB-005 — Mixed C++/Python impact/post-edit can become too narrow or compensatory

| Field | Value |
| --- | --- |
| Evidence | 2026-05-20, repo `/home/fl/code/personal/promshim-ch`, `code_intel_impact_map` + `code_intel_post_edit_map`, note hash `f20f09a5cab38542` |
| Feedback | Low usefulness; incomplete; missed important context; latency unacceptable; note says impact timed out/no parsed files on scoped C++/Python diff, and post-edit found no changed symbols, requiring manual reads/rg. |
| Issue class | Unsupported/mixed-language fallback gap; slow/partial result. |
| Suspected module | reusable impact coverage reporting; post-edit fallback rows; C++/Python parser/provider limits. |
| Candidate fixture | Small mixed C++/Python changed-file set; assert supported/fallback-only files and concrete next-step guidance are visible. |
| Priority | P1 |

### CI-FB-006 — C++ impact failures should produce actionable fallback information

| Field | Value |
| --- | --- |
| Evidence | 2026-05-06 and 2026-05-08, repo `/home/fl/code/personal/promshim-ch`, `code_intel_impact_map`, note hashes `1578f9ea3268911c`, `531895b0c1dfe277`, `ad23fa4546a8b355` |
| Feedback | Low or no usefulness; incomplete; notes mention memory access out-of-bounds or no supported current-source files parsed for ClickHouse C++ files. |
| Issue class | Unsupported/error fallback gap. |
| Suspected module | reusable C/C++ parser handling, impact-map error/coverage reporting, fallback guidance. |
| Candidate fixture | Unsupported/error fixture that asserts failures name affected files and suggest `file_outline`, `repo_route`, `local_map`, or project-native validation where appropriate. |
| Priority | P2 |

### CI-FB-007 — Broad route/overview queries need narrowing guidance

| Field | Value |
| --- | --- |
| Evidence | 2026-06-06, repo `/home/fl/code/personal/claude-cloud-agents`, `code_intel_repo_overview`, `code_intel_repo_route`, `code_intel_file_outline`, note hash `d7c000350cf8b838` |
| Feedback | Medium usefulness; noisy; ranking mixed; query too broad; truncation minor; note says route query was initially too broad/noisy until split. |
| Issue class | Noisy or too-broad result; ranking/scope-control gap. |
| Suspected module | reusable `src/slices/repo-route/run.ts` scoring; `src/slices/repo-route/compact.ts` guidance; possibly overview compact truncation hints. |
| Candidate fixture | Repeated broad term across docs/source/tests; assert exact source/path evidence ranks above generic literal matches and compact output suggests narrower terms/paths or `local_map`. |
| Priority | P1 |

### CI-FB-008 — Same-name helpers and generic terms dilute impact/local ranking

| Field | Value |
| --- | --- |
| Evidence | Representative note hashes `2afb868852ac13c4`, `41f57ead9d7c819a`, `57d96a2784b10f51`, `5665c56b20eeb081` |
| Feedback | Medium usefulness; noisy; ranking mixed; notes mention same-name helper matches, repeated call rows, and generic roots like `New`, `related`, or `compactText` diluting focused audits. |
| Issue class | Ranking/noise gap. |
| Suspected module | reusable impact/local ranking, deduplication, and compact grouping. |
| Candidate fixture | Focused symbol change with common helper names; assert stronger path/symbol evidence ranks above generic same-name rows and repeated calls are grouped. |
| Priority | P2 |

### CI-FB-009 — File outline path failures need better actionable context

| Field | Value |
| --- | --- |
| Evidence | 2026-05-17, repo `/home/fl/code/personal/pi`, `code_intel_file_outline`, note hash `14fed6857b344bcd` |
| Feedback | Low usefulness; incomplete; missed context; follow-up search compensatory; note says stale/nonexistent path failed quickly but compact failure did not give enough path-mismatch context. |
| Issue class | Documentation/error-message gap. |
| Suspected module | reusable path normalization and outline error compact rendering. |
| Candidate fixture | Bad path under existing repo; assert error suggests nearby path or path-base distinction when available. |
| Priority | P3 |

## Promoted implementation slices

### Slice 01 — TypeScript package source-of-truth adoption

Promotes the architectural prerequisite raised after Slice 00: Pi should consume the standalone TypeScript package at `/home/fl/code/personal/code-intel/` instead of preserving a vendored mirror as the behavior source.

Reason: feedback fixes should land in the real reusable implementation. Continuing against the Pi extension mirror would preserve the split source-of-truth problem.

Primary task: choose the Pi/package integration boundary and create the adapter migration slice.

Status: completed. Decision recorded in `docs/package-integration-decision.md`; follow-up migration slice is `slices/01b-package-adapter-migration.md`.

Expected slice file: `slices/01-typescript-package-source-of-truth.md`.

### Slice 02 — Post-edit summary and project-boundary regression

Promotes: CI-FB-001 and CI-FB-002, with test scaffolding that supports CI-FB-004 later.

Reason: this combines the strongest frequency signal (`better_summary`) with the clearest recent low-usefulness C# boundary failure. It is the first feedback behavior slice after package source adoption.

Primary edit repository after Slice 01: `/home/fl/code/personal/code-intel/`. Do not default to the Pi extension mirror unless the user explicitly accepts a temporary bridge.

Expected slice file: `slices/02-post-edit-summary-boundaries.md`.

### Slice 03 — Diagnostic trust and slow/partial post-edit clarity

Promotes: CI-FB-003 and CI-FB-004.

Reason: diagnostics are useful but repeated false-positive/staleness feedback reduces trust; slow post-edit runs need timing and partial-result clarity.

Primary edit repository after Slice 01: `/home/fl/code/personal/code-intel/` plus Pi diagnostic surface text/hooks only if integration-specific behavior changes.

Expected slice file: `slices/03-diagnostics-timing-trust.md`.

### Slice 04 — Route ranking and broad-query scope control

Promotes: CI-FB-007 and part of CI-FB-008.

Reason: broad/noisy route feedback is repeated but less severe than post-edit failures. It should follow the post-edit improvements.

Primary edit repository after Slice 01: `/home/fl/code/personal/code-intel/` route scoring/compact output plus Pi adapter/docs if needed.

Expected slice file: `slices/04-route-ranking-scope-control.md`.

### Deferred candidate — Mixed-language and C++ fallback polish

Tracks: CI-FB-005 and CI-FB-006.

Reason: important, but likely requires more parser/provider investigation and may be larger than the first pass. Keep in the backlog unless the user prioritizes promshim/ClickHouse C++ behavior specifically.

Candidate future file: `slices/04-mixed-language-fallbacks.md`.

### Deferred candidate — Outline/path error polish

Tracks: CI-FB-009.

Reason: useful but isolated and lower priority than post-edit and route feedback.

## Baseline validation status

Slice 00 baseline validation completed successfully:

- `/home/fl/code/personal/code-intel`: `npm run typecheck` — pass.
- `/home/fl/code/personal/code-intel`: `npm test` — pass, 10 tests.
- `/home/fl/code/personal/pi/agent/extensions`: `npm run typecheck` — pass.

Placeholder scan over `.pi/plans/code-intel-feedback-improvements/` and the pointer file found no banned planning placeholders.
