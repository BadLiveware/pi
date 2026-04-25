---
name: paper-code-audit
description: Compare a paper's claims against its public codebase. Use when the user asks to audit a paper, check code-claim consistency, verify reproducibility of a specific paper, or find mismatches between a paper and its implementation.
---

# Paper-Code Audit

Use the bundled prompt reference at `../prompts/audit.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`, `feynman-verifier`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: audit report in `.pi/feynman/outputs/`.
