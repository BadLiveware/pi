# Feynman Skill Integration

These files adapt selected Feynman CLI research workflows for this standalone Pi agent setup. The local files in this repository are the source of truth for this integration; do not read or depend on an external Feynman CLI checkout unless the user explicitly asks you to work on that repo.

## Pi subagents

This integration uses namespaced Pi subagents so normal Pi builtin agents are not overridden:

- `feynman-researcher`
- `feynman-reviewer`
- `feynman-writer`
- `feynman-verifier`

Their source files live in `agent/agents/*.md` and are linked into `~/.pi/agent/agents/` by `link-into-pi-agent.sh`. Do not refer to Feynman CLI `.feynman/agents/*.md` as the runtime source of truth in this repo.

Before relying on a subagent in another environment, check current availability with the `subagent` tool or the Pi subagents UI. If a Feynman subagent is unavailable, continue directly or use an available generic agent and record the degraded path.

## What belongs here

Keep this file focused on cross-agent research conventions:

- output locations and file naming expectations
- workspace-level continuity expectations for long-running work
- provenance and verification requirements
- handoff rules between the lead agent and subagents

Do not restate per-agent prompt text here unless there is a repo-wide constraint that applies to all Feynman workflow agents.

## Output conventions

- Plans go in `.pi/plans/`.
- Research outputs go in `.pi/feynman/outputs/` unless the user requests another path.
- Paper-style drafts go in `.pi/feynman/papers/` unless the user requests another path.
- Session logs go in `.pi/feynman/notes/` unless the user requests another path.
- Intermediate drafts and notes may use `.pi/feynman/drafts/` and `.pi/feynman/notes/`.
- Intermediate research artifacts are written to disk by subagents and read by the lead agent. They are not returned inline unless the user explicitly asks for them.
- Long-running workflows should treat the plan artifact as externalized working memory, not a static outline. Keep task status and verification state there as the run evolves.
- Do not create or update a workspace-root `CHANGELOG.md` unless the user asks or the workspace already has an explicit research lab-notebook convention.

## File naming

Every workflow that produces artifacts must derive a short **slug** from the topic (lowercase, hyphens, no filler words, ≤5 words — e.g. `cloud-sandbox-pricing`). All files in a single run use that slug as a prefix:

- Plan: `.pi/plans/<slug>.md`
- Intermediate research: `.pi/feynman/notes/<slug>-research-web.md`, `.pi/feynman/notes/<slug>-research-papers.md`, etc.
- Draft: `.pi/feynman/drafts/<slug>-draft.md`
- Cited brief: `.pi/feynman/drafts/<slug>-cited.md`
- Verification: `.pi/feynman/notes/<slug>-verification.md`
- Final output: `.pi/feynman/outputs/<slug>.md` or `.pi/feynman/papers/<slug>.md`
- Provenance: `<slug>.provenance.md` next to the final output

Never use generic names like `research.md`, `draft.md`, `brief.md`, or `summary.md`. Concurrent runs must not collide.

## Provenance and verification

- Every output from deep research and literature review workflows must include a `.provenance.md` sidecar.
- Provenance sidecars should record source accounting and verification status.
- Source verification and citation cleanup belong in the `feynman-verifier` stage when that agent is available; otherwise the lead agent must perform and record the checks directly.
- Verification passes should happen before delivery when the workflow calls for them.
- If a workflow uses the words `verified`, `confirmed`, or `checked`, the underlying artifact should record what was actually checked and how.
- For quantitative or code-backed outputs, keep raw artifact paths, scripts, or logs that support the final claim. Do not rely on polished summaries alone.
- Never smooth over missing checks. Mark work as `blocked`, `unverified`, or `inferred` when that is the honest status.

## Delegation rules

- The lead agent plans, delegates, synthesizes, and delivers.
- Use subagents when the work is meaningfully decomposable; do not spawn them for trivial work.
- Prefer file-based handoffs over dumping large intermediate results back into parent context.
- The lead agent is responsible for reconciling task completion. Subagents may not silently skip assigned tasks; skipped or merged tasks must be recorded in the plan artifact.
- For critical claims, require at least one adversarial verification pass after synthesis. Fix fatal issues before delivery or surface them explicitly.
