# Instruction Metadata

This directory holds provenance and notices that should stay out of agent-facing instruction bodies.

## Purpose

- `notices/` stores third-party attribution and license notices that do not belong in the instruction text itself.

## Workflow

- Keep Pi-required frontmatter in the markdown files under `agent/`.
- Keep attribution, provenance, and other non-instructional notices here instead of in skill or agent bodies.
- Run `./link-into-pi-agent.sh` after changing files under `agent/`.
