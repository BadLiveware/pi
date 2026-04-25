---
description: Autonomous experiment loop — try ideas, measure results, keep what works, discard what doesn't, repeat.
args: <idea>
section: Research Workflows
---
Start an autoresearch optimization loop for: $@

This command uses pi-autoresearch.

## Step 1: Gather

If `autoresearch.md` and `autoresearch.jsonl` already exist, ask the user if they want to resume or start fresh.
If the workspace already uses `CHANGELOG.md` as an explicit research lab notebook, read the most recent relevant entries before resuming.

Otherwise, collect the following from the user before doing anything else:
- What to optimize (test speed, bundle size, training loss, build time, etc.)
- The benchmark command to run
- The metric name, unit, and direction (lower/higher is better)
- Files in scope for changes
- Maximum number of iterations (default: 20)

## Step 2: Environment

Ask the user where to run:
- **Local** — run in the current working directory
- **New git branch** — create a branch so main stays clean
- **Virtual environment** — create an isolated venv/conda env first
- **Docker** — run experiment code inside an isolated Docker container

Do not proceed without a clear answer.

## Step 3: Confirm

Present the full plan to the user before starting:

```
Optimization target: [metric] ([direction])
Benchmark command:   [command]
Files in scope:      [files]
Environment:         [chosen environment]
Max iterations:      [N]
```

Ask the user to confirm. Do not start the loop without explicit approval.

## Step 4: Run

Initialize the session: create `autoresearch.md`, `autoresearch.sh`, run the baseline, and start looping.

Each iteration: edit → commit → `run_experiment` → `log_experiment` → keep or revert → repeat. Do not stop unless interrupted or `maxIterations` is reached.
After the baseline and meaningful iteration milestones, append concise progress notes to `.pi/feynman/notes/<slug>-log.md`; use a workspace-root `CHANGELOG.md` only if the workspace already has that explicit research lab-notebook convention.

## Key tools

- `init_experiment` — one-time session config (name, metric, unit, direction)
- `run_experiment` — run the benchmark command, capture output and wall-clock time
- `log_experiment` — record result, auto-commit, update dashboard

## Subcommands

- `/autoresearch <text>` — start or resume the loop
- `/autoresearch off` — stop the loop, keep data
- `/autoresearch clear` — delete all state and start fresh
