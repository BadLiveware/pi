---
name: autoresearch
description: Autonomous experiment loop that tries ideas, measures results, keeps what works, and discards what doesn't. Use when the user asks to optimize a metric, run an experiment loop, improve performance iteratively, or automate benchmarking.
---

# Autoresearch

Use the bundled prompt reference at `../prompts/autoresearch.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Tools used: `init_experiment`, `run_experiment`, `log_experiment` (from pi-autoresearch)

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: session files such as `autoresearch.md`, `autoresearch.sh`, and `autoresearch.jsonl`.
