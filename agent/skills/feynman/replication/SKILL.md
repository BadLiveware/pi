---
name: replication
description: Plan or execute a replication of a paper, claim, or benchmark. Use when the user asks to replicate results, reproduce an experiment, verify a claim empirically, or build a replication package.
---

# Replication

Use the bundled prompt reference at `../prompts/replicate.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: replication plan, scripts, and results saved to disk.
