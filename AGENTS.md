# AGENTS.md

## Purpose

This repository contains the source for your global pi agent instructions and support files. Work here on the instruction system itself, not on an individual project.

## Source of Truth

- Treat `agent/` as the source of truth for files that should appear in `~/.pi/agent`.
- Do not edit `~/.pi/agent` directly unless you are debugging the live environment and the user explicitly wants that.
- Root-level files are for repository-local meta guidance and tooling. They are not part of the global agent payload unless the linking script says so.

## Guidelines
- Start extension work with vertical slices. Put behavior, rendering, schemas, persistence, artifact handling, and tests in feature/workflow modules from the beginning; keep `index.ts` mostly registration and wiring.
- Do not grow massive single-file extensions unless it is truly the best option (it probably is not). If an extension file is already large, add new behavior in a slice module instead of making the large file larger.
- Fast forward pushes to main are allowed, as long as gitleaks commit hook passes 

## Layout

- `agent/AGENTS.md` is the global always-loaded instruction file.
- `agent/skills/` contains discoverable skills.
- `agent/extensions/`, `agent/mcp.json`, `agent/agents/`, and `agent/keybindings.json` are linked into `~/.pi/agent`.
- `link-into-pi-agent.sh` syncs the contents of `agent/` into `~/.pi/agent` via symlinks.

## Working on Global Instructions

- Keep `agent/AGENTS.md` lean because it is always injected. Aim for <200 lines
- Put universal policy in `agent/AGENTS.md` and conditional procedure in skills.
- Keep skill descriptions short, trigger-based, and focused on when to use the skill, not how the skill works.
- Keep skill bodies scan-friendly, direct, and consistent.
- Prefer second-person language (`you`) in instructions and skills.
- When you move, rename, add, or remove files under `agent/`, update the linking behavior and clean up stale symlinks.

## Validation

After changing global agent files:
1. Run `./link-into-pi-agent.sh` or `./link-into-pi-agent.sh --force` if existing managed paths need to be replaced.
2. Verify the symlinks in `~/.pi/agent` point into `agent/`.
3. Check changed files for obvious structural problems, such as invalid JSON or broken paths.
4. Summarize what changed in the source files and what changed in the live linked layout.

## Safety Boundaries

- Do not overwrite real files in `~/.pi/agent` if they are not symlinks managed by this repository unless the user explicitly asks for that.
- Be careful not to confuse this repository’s root `AGENTS.md` with `agent/AGENTS.md`; they serve different purposes.
