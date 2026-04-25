---
name: paper-writing
description: Turn research findings into a polished paper-style draft with sections, equations, and citations. Use when the user asks to write a paper, draft a report, write up findings, or produce a technical document from collected research.
---

# Paper Writing

Use the bundled prompt reference at `../prompts/draft.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-writer`, `feynman-verifier`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: paper draft in `.pi/feynman/papers/`.
