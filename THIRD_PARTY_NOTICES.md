# Third-party notices

This repository is a personal Pi setup, but parts of it were shaped by useful public work. Thank you to the people and projects below.

## pcvelz/superpowers

Some agent skills adapt ideas, structure, and testing discipline from `pcvelz/superpowers`, especially the skill-writing and skill-testing guidance.

- Source: https://github.com/pcvelz/superpowers
- License: MIT
- Local notice: [`agent/skills/writing-skills/SUPERPOWERS-LICENSE.md`](./agent/skills/writing-skills/SUPERPOWERS-LICENSE.md)

Skills with explicit attribution include:

- [`agent/skills/writing-skills/SKILL.md`](./agent/skills/writing-skills/SKILL.md)
- [`agent/skills/writing-skills/testing-skills-with-subagents.md`](./agent/skills/writing-skills/testing-skills-with-subagents.md)
- [`agent/skills/systematic-debugging/SKILL.md`](./agent/skills/systematic-debugging/SKILL.md)
- [`agent/skills/verification-before-completion/SKILL.md`](./agent/skills/verification-before-completion/SKILL.md)

## Feynman

The Feynman skills and research workflow prompts adapt selected workflows from Feynman CLI for this standalone Pi setup.

- Source: https://github.com/getcompanion-ai/feynman
- License: MIT
- Copyright: Companion, Inc.
- Local notice: [`agent/skills/feynman/FEYNMAN-LICENSE.md`](./agent/skills/feynman/FEYNMAN-LICENSE.md)

The adapted integration lives under:

- [`agent/skills/feynman/`](./agent/skills/feynman/)
- [`agent/agents/feynman-researcher.md`](./agent/agents/feynman-researcher.md)
- [`agent/agents/feynman-reviewer.md`](./agent/agents/feynman-reviewer.md)
- [`agent/agents/feynman-writer.md`](./agent/agents/feynman-writer.md)
- [`agent/agents/feynman-verifier.md`](./agent/agents/feynman-verifier.md)

## Pi

The extensions in this repository are built for [Pi](https://pi.dev) and use Pi's extension APIs from packages such as `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui`.

- Source: https://github.com/badlogic/pi-mono

The public extension packages declare Pi packages as peer dependencies and do not bundle Pi source code.
