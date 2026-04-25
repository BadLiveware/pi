---
name: source-comparison
description: Compare multiple sources on a topic and produce a grounded comparison matrix. Use when the user asks to compare papers, tools, approaches, frameworks, or claims across multiple sources, or when planning depends on choosing between competing options.
---

# Source Comparison

Use the bundled prompt reference at `../prompts/compare.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`, `feynman-verifier`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: comparison matrix in `.pi/feynman/outputs/`.
