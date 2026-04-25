---
name: peer-review
description: Simulate a tough but constructive peer review of an AI research artifact. Use when the user asks for a review, critique, feedback on a paper or draft, or wants to identify weaknesses before submission.
---

# Peer Review

Use the bundled prompt reference at `../prompts/review.md` as the workflow instructions and execute it directly with the currently available Pi tools. Do not require the Feynman CLI.

Agents used: `feynman-researcher`, `feynman-reviewer`

Before starting, check that any named tools or subagents are available. If a capability is missing, continue in degraded mode when safe and record what was not run.

Output: structured review in `.pi/feynman/outputs/`.
