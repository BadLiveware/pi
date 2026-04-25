---
name: watch
description: Set up a recurring research watch on a topic, company, paper area, or product surface. Use when the user asks to monitor a field, track new papers, watch for updates, or set up alerts on a research area.
---

# Watch

Use the bundled prompt reference at `../prompts/watch.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: baseline survey in `.pi/feynman/outputs/`, recurring checks via `schedule_prompt`.
