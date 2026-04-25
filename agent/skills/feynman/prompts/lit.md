---
description: Run a literature review on a topic using paper search and primary-source synthesis.
args: <topic>
section: Research Workflows
---
Investigate the following topic as a literature review: $@

Derive a short slug from the topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

## Workflow

1. **Plan** — Outline the scope: key questions, source types to search (papers, web, repos), time period, expected sections, and a small task ledger plus verification log. Write the plan to `.pi/plans/<slug>.md`. Briefly summarize the plan to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested plan review.
2. **Gather** — Use the `feynman-researcher` subagent when the sweep is wide enough to benefit from delegated paper triage before synthesis. For narrow topics, search directly. Researcher outputs go to `<slug>-research-*.md`. Do not silently skip assigned questions; mark them `done`, `blocked`, or `superseded`.
3. **Synthesize** — Separate consensus, disagreements, and open questions. When useful, propose concrete next experiments or follow-up reading. Generate charts only when chart tooling is available for source-backed quantitative comparisons across papers; use Mermaid diagrams for taxonomies or method pipelines. Before finishing the draft, sweep every strong claim against the verification log and downgrade anything that is inferred or single-source critical.
4. **Cite** — Spawn the `feynman-verifier` agent to add inline citations and verify every source URL in the draft.
5. **Verify** — Spawn the `feynman-reviewer` agent to check the cited draft for unsupported claims, logical gaps, zombie sections, and single-source critical findings. Fix FATAL issues before delivering. Note MAJOR issues in Open Questions. If FATAL issues were found, run one more verification pass after the fixes.
6. **Deliver** — Save the final literature review to `.pi/feynman/outputs/<slug>.md`. Write a provenance record alongside it as `.pi/feynman/outputs/<slug>.provenance.md` listing: date, sources consulted vs. accepted vs. rejected, verification status, and intermediate research files used. Before you stop, verify on disk that both files exist; do not stop at an intermediate cited draft alone.
