---
name: jobs
description: Inspect active background research work including running processes, scheduled follow-ups, and pending tasks. Use when the user asks what's running, checks on background work, or wants to see scheduled jobs.
---

# Jobs

Use the bundled prompt reference at `../prompts/jobs.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: active managed processes, scheduled prompts, and running subagent tasks.
