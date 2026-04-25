---
name: literature-review
description: Run a literature review using paper search and primary-source synthesis. Use when the user asks for a lit review, paper survey, state of the art, academic landscape summary, or when planning a research-heavy subject needs paper-backed context.
---

# Literature Review

Use the bundled prompt reference at `../prompts/lit.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`, `feynman-verifier`, `feynman-reviewer`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: literature review in `.pi/feynman/outputs/` with `.provenance.md` sidecar.
