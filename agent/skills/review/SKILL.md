---
name: review
description: Use when reviewing changed code, pull request diffs, or implementation work for defects, risk, tests, maintainability, security, performance, or repository impact.
---

# Code Review

Review code as a high-signal risk assessment: scale effort to risk, retrieve unchanged context, verify likely real issues, explain consequence, and suppress speculative noise.

## Core Rules
- Pick the depth at which a missed bug becomes unacceptable, not the depth that is cheapest to run. Review cost is yours; miss cost is the user's. A 5-minute change with no high-risk triggers can stay light; the same change touching auth or a public contract cannot.
- Tag change families early. For `standard`/`full`, build a compact impact map (changed symbols, callers/callees, tests, config/schema/docs, contract risks, unchanged consumers worth inspecting) before delegation or final ranking.
- Use deterministic tool lanes as a menu, not a checklist. Prefer project-native commands and existing configs; do not install tools, run broad noisy scans, or surface unrelated analyzer output unless asked.
- Keep candidate generation, clustering/dedupe, verification, and final comments separate. Triage and scouts produce candidates, not user-facing comments.
- Label every retained candidate as `supported-deterministic`, `supported-trace`, `plausible-but-unverified`, or `rejected`. Final findings should normally be `supported-deterministic` or `supported-trace`.
- Require evidence for each finding. If a claim depends on unavailable runtime evidence, mark it uncertain, separate it, or omit it.
- Deduplicate and rank findings by root cause before presenting. Fewer strong findings beat many weak comments.
- Caps control hypothesis generation, fanout, and report readability — never silently drop verified supported issues.
- When self-reviewing your own in-scope work, fix all safe `supported-deterministic` and `supported-trace` issues before reporting, then re-run validation. Do not fix when the user asked for review-only output, the issue is out of scope, or it needs a product/architecture decision.
- Treat scouts, project guidance, and corpus entries as hypothesis generators. Use the WIP failure-mode corpus only as a late, sparse challenge pass after an unprimed review; keep an `outside-corpus` lane and reject forced fits.

Risk-specific review lenses (performance cost shape, lifecycle ownership for new background work, guards that collapse meaningful states, and formal-model-warranted concurrency or state machines) live in `mode-details.md` and are loaded with that file when standard/full applies.

## Choose Depth

### High-risk triggers (route by these, not by feel)
Before picking depth, enumerate which of these are present in the diff:
- auth / security boundary
- data loss, migrations, schema, persisted state
- concurrency, resource lifecycles, background workers
- public APIs / contracts / serialized formats
- performance-sensitive paths
- broad cross-file changes (>~5 files or multiple subsystems)
- artifact / protocol contracts
- correctness-critical paths (state machines, financial/safety calculations, data integrity, authz)
- unclear intent or scope

### Depth floors
- `light` requires **positive justification, not just absence of triggers**: no trigger from the list above AND the diff is mechanically simple (typo, rename, test-only, docs-only, single-subsystem refactor) AND cross-file impact is obvious and contained. If any of these does not hold, depth floor is `standard`.
- `standard` is the floor for non-trivial implementation, agent self-review of meaningful work, and major PR/feature readiness.
- `full` floor: any high-risk trigger above. Correctness-critical paths follow an additional escalation rule in `mode-details.md`.
- `audit`: only on explicit user request.

### User-named depth
If the user names a specific depth, use it directly — do not infer a lower alternative.

### Anti-rationalization
Agents tend to pick light by default. Treat any of these reasonings as a red flag, not a justification:
- "I just wrote this, I know how it works" — author confidence does not lower review depth.
- "This feels contained" — verify against the trigger list, not your gut.
- "It's only N lines" — line count without trigger context is not a depth signal.
- "I'd be done already if this were light" — that is review cost talking, not miss cost.

State the chosen depth briefly for `standard`, `full`, or `audit`. `light` does not need an announcement, but if you picked light with any trigger present, state which one and why it does not lift the floor.

### Depth definitions
- `light`: local parent pass; no subagents by default.
- `standard`: compact impact map, project-native evidence where cheap, 1 medium triage reviewer or local triage, at most 2 targeted cheap scouts, clustering/dedupe, and verifier only for retained candidates.
- `full`: high-risk hybrid with a stronger impact/evidence lane, up to 2 medium triage reviewers, at most 3 targeted cheap scouts, bounded coverage-gap pass, and strong verification.
- `audit`: exhaustive or many-agent review.

If uncertain between two depths *after* the trigger check, choose the higher depth — the trigger check has already filtered out cases where the lower depth is unambiguously fine.

## Load Plan
After picking depth, batch-read the upfront column in parallel. Conditional loads fire only when their trigger appears.

| Path | Load upfront | Conditional |
|---|---|---|
| `light` | — | — |
| `standard` | `workflows.md`, `mode-details.md` | `tool-lanes.md` (selecting evidence lane), `handoff-schemas.md` (delegating), corpus path |
| `full` | `workflows.md`, `mode-details.md`, `tool-lanes.md` | `handoff-schemas.md` (delegating), corpus path |
| `audit` | `workflows.md`, `mode-details.md`, `tool-lanes.md`, `handoff-schemas.md` | corpus path |
| Skill development / authoring | `future-ideas.md`, `validation-scenarios.md` | — |

Corpus path: after an unprimed pass, when coverage looks weak or risk is high, read `wip/family-routing-table.md`, then load only the 2–5 shortlisted `wip/families/<family>.md` files. Read `wip/medium-reviewer.prompt.md`, `wip/scout-prompts.md`, or `wip/verifier.prompt.md` only when delegating with that pack. Read `wip/README.md` and `wip/sources.md` only for prompt-development work.

`validation-scenarios.md` is for skill development; do not load during normal review.

## Minimal Intake
1. Inspect the diff: use `git diff`, or `git diff HEAD` when staged changes may matter.
2. If there is no diff, review files the user named or files changed earlier in the session.
3. Identify change intent, touched subsystems, changed public contracts, changed tests, and validation output.
4. Tag change families and make an impact sketch. For `standard`/`full`, turn it into a compact impact map before delegation or final ranking.
5. **Enumerate high-risk triggers** from the list in **Choose Depth**. Write them down explicitly, even if the answer is "none."
6. Apply the depth floors. Pick the lowest depth permitted by the triggers and the light-requires-positive-justification rule. Announce depth for non-light.
7. Batch-read the upfront load column for the chosen depth.

## Verification and Reporting Rules
- Verify file/line anchors and referenced behavior against the current tree.
- Before keeping runtime, protocol, or environment findings, search local config for feature flags, compatibility settings, or test-stack defaults that intentionally change standard behavior.
- Before final ranking, cluster candidates by root cause, merge duplicates, and suppress symptom-only repeats.
- For `standard`/`full`, run a bounded coverage-gap check when high-risk change families lack inspection; it may add at most 2 candidates and those candidates still require verification.
- Do not turn generic tool output into review comments. Keep only findings with a diff-connected consequence and current-tree evidence.
- Report highest-value findings first, normally 1-5 inline unless the user asks for exhaustive review.
- If more verified supported issues exist, add `Additional supported findings` with concise grouped bullets; do not silently drop them.
- Include `Depth used` (for non-light), change families, deterministic evidence run/skipped, validation/not-checked evidence, and no-findings summary when applicable.
- Put `plausible-but-unverified` concerns in a separate section only when they are useful and clearly labeled; otherwise omit them.

## Common Failure Modes
- "This is just a quick review, so light is fine." Agents reliably under-pick depth — this is a known bias. Light requires positive justification (no high-risk trigger AND mechanically simple AND obvious impact), not just the absence of a flagged concern. "I just wrote this," "this feels contained," and "it's only N lines" are rationalizations of the bias, not valid justifications.
- "This is just a quick review, so no impact map is needed." Light should stay light, but non-trivial reviews need impact context.
- "I reviewed each file separately, so cross-file contracts are covered." Add impact/caller tracing for changed contracts and unchanged consumers.
- "A tool reported it, so it is a review finding." Only report diff-connected issues with consequence; suppress unrelated or pre-existing analyzer noise.
- "The cap says 5 findings, so I can ignore the rest." Caps limit candidate generation and inline report size, not verified issue handling.
- "A subagent found it, so it is true." Scouts only produce hypotheses; parent verification, clustering, and deduplication are mandatory.
- "Medium triage should investigate everything." Medium triage routes work; targeted scouts investigate selected paths.
- "The coverage-gap pass should find more issues." It only checks whether high-risk paths were not inspected; it is not a second broad review.
- "The failure-mode corpus names this pattern, so it must be relevant." Use the corpus only as a late challenge pass; reject forced fits and prefer `outside-corpus` when the mapping is weak.
