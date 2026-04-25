# pi-plan-mode

Read-only planning mode extension for [Pi](https://pi.dev).

## Features

- `/plan` toggles a read-only planning mode.
- `Ctrl+Alt+P` toggles planning mode.
- Restricts active tools while planning.
- Blocks non-allowlisted shell commands during planning.
- Extracts numbered plan steps from assistant output.
- Tracks `[DONE:n]` markers during execution.
- `/tools-restore-all` restores every configured tool if a prior reduced tool set gets stuck.

## Install

From npm after publishing:

```bash
pi install npm:pi-plan-mode
```

From a local checkout:

```bash
pi install /path/to/pi-plan-mode
```

For one-off testing:

```bash
pi -e /path/to/pi-plan-mode
```

## Commands

- `/plan` — toggle plan mode.
- `/todos` — show the current extracted todo list.
- `/tools-restore-all` — restore all configured tools.
