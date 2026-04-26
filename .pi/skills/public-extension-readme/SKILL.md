---
name: public-extension-readme
description: Use when writing or editing README or user-facing documentation for public Pi extensions in this repository.
---

# Public Extension README

Respect the reader's time. A public extension README should help a user decide whether to install the extension and successfully use it, without making them read marketing copy or implementation archaeology.

## Required Shape

Start with the useful answer:

1. **What it does** — one or two plain sentences naming the visible behavior.
2. **Problem it solves** — why a Pi user would want it; keep this concrete.
3. **How it works** — a brief mechanism summary only where it improves trust, configuration, or troubleshooting.
4. **How to use it** — install command, important commands/tools/events, required configuration, and one minimal example.

If a README already has these pieces, tighten it instead of adding another section.

## Style Rules

- Prefer short sections, bullets, tables, and copy-paste commands.
- Put the most common path before edge cases and internals.
- Name required credentials, environment variables, CLIs, or services explicitly.
- Say how the extension behaves when optional tools or credentials are missing.
- Keep implementation details out unless they affect user behavior, safety, compatibility, or debugging.
- Avoid hype, long origin stories, exhaustive feature prose, and repeated restatements of the same behavior.
- Use examples sparingly; every example must teach setup or usage.
- Do not assume the reader has this repository's private setup.

## Review Checklist

Before finishing a public extension README, check:

- Can a new Pi user tell in the first screen what the extension does?
- Is the install command correct for the package being documented?
- Are commands, tools, events, and config files named exactly?
- Are dependencies and failure/degraded modes documented without overexplaining?
- Did you remove prose that does not help install, decide, use, configure, or troubleshoot?
