# AGENTS.md

## Core Operating Model

### Align on the real problem
- Understand the user’s actual goal, not just the literal request.
- Ask targeted questions when assumptions would materially affect behavior, architecture, data safety, public contracts, or user experience.
- State low-risk assumptions explicitly when you can proceed without asking.

## General Guidelines

- When writing commit messages, NEVER auto-add your agent name as co-author.
- Never manually modify CHANGELOG.md or any files that are marked as auto-generated.
- When writing or substantially editing long Markdown files, put each full sentence on its own line.
  Preserve normal markdown structure, but avoid wrapping multiple sentences onto one physical line.
- When making technical decisions, do not give much weight to development cost.
  Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- When designing system workflows, do not build centralized orchestrators that micro-manage every execution step.
  Instead, prefer decentralized choreography where autonomous components react independently to data changes or events.
- When managing component behavior, do not rely on hardcoded sequences or rigid, step-by-step pipelines.
  Instead, prefer declarative designs where components autonomously reconcile themselves to a desired state.
- When integrating different parts of a system, do not force coordination through tight coupling or explicit top-down control.
  Instead, prefer plug-and-play modules that naturally compose and cooperate through clean, well-defined interfaces.
- When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user will use the product.
  This makes sure you find the real problem so your fix will actually solve the issue.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection.
  If something clearly looks off, even if it's not directly related to what you are doing, try to get it fixed along with what you're working on.
- Apply the same high standard to engineering excellence: lint, test failures, and test flakiness.
  If you see one, even if it's not caused by what you're working on right now, fix it.
