# Code Review Workflows

Load this file only after `SKILL.md` when a path-specific workflow applies.

## Self-review After Implementation
Use when you are reviewing your own in-scope implementation work before claiming completion.

1. Default to `light` unless high-risk triggers appear.
2. Inspect the current diff and changed tests.
3. Verify findings as `supported`, `plausible but unverified`, or `rejected`.
4. Fix all safe supported in-scope issues.
5. Do not auto-fix plausible/unverified issues, out-of-scope issues, or issues needing product/architecture decisions.
6. Re-run relevant validation after fixes.
7. Report depth used, what was fixed, validation, and any remaining supported/unresolved/out-of-scope findings grouped by root cause.

If there are many supported issues:
- fix shared root causes first,
- fix safe/local issues in priority order,
- do not silently drop remaining supported issues,
- continue if still in scope; otherwise list what remains and why.

## User-requested Review
Use when the user asks for review, code review, PR review, or asks what issues exist.

1. Infer `light`, `standard`, or `full` from risk and wording.
2. State the selected depth briefly.
3. If the user asked for review-only/findings/comments, do not edit files.
4. If the user asked for review-and-fix, fix supported in-scope issues after verification and validate.
5. For ambiguous requests, default to report-only unless the surrounding task scope already includes implementation.

## Major PR / Feature Readiness
Use when a major feature or PR is mostly/fully done.

1. Default to `standard`.
2. Escalate to `full` for auth/security, data loss, migrations/schema/config, concurrency/resource lifecycles, public APIs/contracts, performance-sensitive paths, broad cross-file changes, artifact/protocol contracts, or unclear intent.
3. Build a compact context packet with changed contracts, tests, validation, config, and likely consumers.
4. Use hybrid triage/scout/verifier flow from `mode-details.md`.
5. Report readiness blockers first, then lower-severity supported findings, validation gaps, and not-checked items.

## Review-and-fix
Use when the user explicitly asks to fix review findings or when self-reviewing in-scope implementation.

1. Verify before editing.
2. Fix supported in-scope issues only.
3. Prefer root-cause fixes over one-off patches.
4. Keep product, architecture, or scope decisions for the user.
5. Re-run relevant validation.
6. Summarize fixed issues and remaining unresolved findings.
