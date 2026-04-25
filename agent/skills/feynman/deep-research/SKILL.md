---
name: deep-research
description: Run a thorough, source-heavy investigation on any topic. Use when the user asks for deep research, a comprehensive analysis, an in-depth report, a multi-source investigation, or when complicated planning needs a cited evidence brief before scope is finalized. Produces a cited research brief with provenance tracking.
---

# Deep Research

Use the bundled prompt reference at `../prompts/deepresearch.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`, `feynman-verifier`, `feynman-reviewer`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: cited brief in `.pi/feynman/outputs/` with `.provenance.md` sidecar.
