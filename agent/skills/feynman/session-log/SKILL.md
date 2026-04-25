---
name: session-log
description: Write a durable session log capturing completed work, findings, open questions, and next steps. Use when the user asks to log progress, save session notes, write up what was done, or create a research diary entry.
---

# Session Log

Use the bundled prompt reference at `../prompts/log.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: session log in `.pi/feynman/notes/`.
