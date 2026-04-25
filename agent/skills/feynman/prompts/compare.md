---
description: Compare multiple sources on a topic and produce a source-grounded matrix of agreements, disagreements, and confidence.
args: <topic>
section: Research Workflows
---
Compare sources for: $@

Derive a short slug from the comparison topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

Requirements:
- Before starting, outline the comparison plan: which sources to compare, which dimensions to evaluate, expected output structure. Write the plan to `.pi/plans/<slug>.md`. Briefly summarize the plan to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested plan review.
- Use the `feynman-researcher` subagent to gather source material when the comparison set is broad, and the `feynman-verifier` subagent to verify sources and add inline citations to the final matrix.
- Build a comparison matrix covering: source, key claim, evidence type, caveats, confidence.
- Generate charts when chart tooling is available and the comparison involves source-backed quantitative metrics. Use Mermaid for method or architecture comparisons.
- Distinguish agreement, disagreement, and uncertainty clearly.
- Save exactly one comparison to `.pi/feynman/outputs/<slug>-comparison.md`.
- End with a `Sources` section containing direct URLs for every source used.
