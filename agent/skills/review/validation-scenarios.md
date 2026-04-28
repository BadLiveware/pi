# Review Skill Validation Scenarios

Use these scenarios when changing the `review` skill.

## Scenario 1: Cross-file contract break
Prompt an agent to review a diff where a function contract changes in one file, only some callers are updated, and a file-by-file review would miss an unchanged caller.

Passes when the agent tags the change as API/contract, performs an impact/caller check, and reports the unchanged caller or explicitly explains why none are affected.

## Scenario 2: Noisy maintainability nits
Prompt an agent to review a working diff with minor style differences and one concrete test gap.

Passes when the agent suppresses taste-only nits and prioritizes the test gap with evidence.

## Scenario 3: Runtime/resource uncertainty
Prompt an agent to review a diff that may leak resources only under runtime conditions, with no tests or logs available.

Passes when the agent either seeks deterministic evidence or labels the resource concern `plausible-but-unverified` instead of presenting it as proven.

## Scenario 4: Subagent reducer discipline
Prompt an agent to run multiple reviewers where two reviewers return duplicates and one speculative finding.

Passes when the parent clusters/deduplicates by root cause, removes or downgrades speculation, verifies anchors, labels support type, and presents only high-signal findings.

## Scenario 5: Runtime/protocol config override
Prompt an agent to review a diff where parallel remote-write batches appear to violate the default receiver ordering contract, but local test-stack config explicitly enables a wide out-of-order window.

Passes when the agent searches or accounts for local config before keeping the protocol finding, then drops or downgrades the finding unless evidence shows the configured receiver still rejects the writes.

## Scenario 6: Cheap semantic scouts before strong verification
Prompt an agent to design or run a non-trivial review with cheap/fast models available and a stronger model available. The diff has a cross-file invariant break, a missing test, and several style distractions.

Passes when the agent builds a compact impact map, assigns narrow scouts to trace correctness, impact/caller, test-gap, and config/protocol paths; requires candidate outputs with semantic paths and missing evidence; clusters duplicates; and reserves final `supported-deterministic` / `supported-trace` / `plausible-but-unverified` / `rejected` decisions for the verifier instead of letting scouts write final comments.

## Scenario 7: Depth selection and hybrid cost control
Prompt an agent with three review requests: a five-minute localized edit, an agent self-review after a medium change, and a major PR readiness review. Include an optional WIP failure-mode corpus.

Passes when the agent chooses light for the small/self-review cases unless concrete high-risk triggers appear; chooses standard or full for the major PR based on risk; uses at most one medium triage reviewer plus targeted scouts for standard review; performs an unprimed pass before any WIP corpus challenge; treats the WIP corpus as non-authoritative routing help rather than a checklist; keeps an outside-corpus lane; and avoids audit-level fanout unless explicitly requested.

## Scenario 8: Self-review fixes in-scope issues
Prompt an agent that has just implemented a medium change to run code review on its own diff. Include one supported-deterministic or supported-trace in-scope issue, one plausible-but-unverified issue, and one out-of-scope product decision.

Passes when the agent fixes all safe `supported-deterministic` or `supported-trace` in-scope issues and reruns relevant validation before summarizing; reports but does not auto-fix the plausible or out-of-scope items; preserves review-only behavior when the user explicitly asks only for findings; and does not use triage/report caps to silently hide additional verified supported issues.

## Scenario 9: Split docs avoid path poisoning
Prompt an agent with two requests: a quick self-review after a medium implementation and a standard PR readiness review that delegates triage/scouts.

Passes when the self-review path loads `workflows.md` but not `mode-details.md`, `handoff-schemas.md`, `tool-lanes.md`, or `wip/` unless concrete high-risk triggers appear; the standard PR path loads `workflows.md`, `mode-details.md`, and `handoff-schemas.md` only when needed for delegation; `tool-lanes.md` is loaded only when selecting deterministic tools; and neither path reads WIP corpus files before an unprimed pass or without a late challenge/audit/prompt-development reason.

## Scenario 10: Tool lanes are evidence menu, not checklist
Prompt an agent to review a TypeScript diff in a repo with `npm run typecheck` and targeted tests, but no configured `semgrep` or `ast-grep`. The user asks for a standard review and mentions that analyzer tooling might help.

Passes when the agent prefers project-native typecheck/tests and caller search, records skipped missing/noisy lanes, does not install or run broad generic analyzers, and reports only diff-connected findings with `supported-deterministic` or `supported-trace` evidence.

## Scenario 11: Bounded coverage-gap pass
Prompt an agent to review a high-risk config/protocol change where triage/scouts inspected tests and changed files but did not inspect unchanged config consumers.

Passes when the agent runs a late coverage-gap check, names the missing config-consumer path, returns at most two new candidates, and verifies any new candidate before presenting it.

## Scenario 12: Evidence-label reporting
Prompt an agent with three candidate findings: one failing targeted test, one anchored caller trace without runtime proof, and one semantic hunch without evidence.

Passes when the final report labels them `supported-deterministic`, `supported-trace`, and `plausible-but-unverified` respectively; reports the first two as findings; and either separates or omits the semantic hunch instead of presenting it as proven.
