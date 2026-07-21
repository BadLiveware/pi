# Stardock Evidence Baseline

## Purpose

Provide reproducible measurements and source anchors that execution slices use before changing status, compatibility, schemas, or tool activation.

## Treehouse baseline

- `/usr/bin/treehouse` is installed and exposes durable `get --lease`, lease-holder labels, `status`, and safe `return`.
- At planning time `treehouse status` reported no worktrees in the pool.
- No repository `treehouse.toml` existed; Slice 00b adds repo-safe `max_trees = 6` without executable hooks.
- Treehouse worktrees default to detached HEAD at the default branch, so every Stardock lane must explicitly reset to the frozen contract SHA and create a unique lane branch before execution.
- A disposable planning probe confirmed `status` emits a second-column `leased`/`available` state, `return` changes leased to available, and safe pool cleanup is `treehouse destroy . --all --yes`; the installed CLI has no `--force` flag and risky classes require explicit `--include-*` flags.

## Current status path

- `src/runtime/ui.ts:updateStardockUI()` publishes one extension status and a persistent widget.
- The status contains loop name, iteration, and workflow state but no WorkerRun identity or activity.
- The widget reports workflow, recursive attempts, outside requests, governor state, and reflection timing; it does not select or display the active worker.
- `src/brief-worker-run-bridge.ts:runSubagentThroughBridge()` receives bridge start/update/response events. Update details include `currentTool` and `toolCount`.
- `src/stardock-worker-tool.ts:runWorker()` creates and saves a `running` WorkerRun before bridge execution and saves the terminal/needs-review transition afterward. It calls `deps.updateUI()` only around durable transitions, not on each bridge update.
- `stardock_worker` has no custom `renderCall` or `renderResult`.
- `src/views.ts:formatRunOverview()` reports WorkerRun/WorkerReport counts; `formatRunTimeline()` renders durable WorkerRuns but is not a live status view.
- `/stardock status` lists loops. `/stardock view` emits an overview notification. Neither is a dedicated active-worker dashboard.

## Footer evidence

The current Footer Framework state has `items.ext.visible = false` and no adapter for extension-status key `stardock`, so Stardock's `ctx.ui.setStatus("stardock", ...)` is absent from that custom footer. The independent `ctx.ui.setWidget("stardock", ...)` surface remains available without Footer Framework configuration and is therefore the required primary passive surface.

Before changing footer integration, capture:

```text
footer_framework_state
```

Expected baseline signal: no rendered item or adapter with id/key `stardock`.

## Tool metadata measurement

Run from repository root:

```bash
node --experimental-strip-types --input-type=module <<'NODE'
import { makeHarness } from './agent/extensions/private/stardock/test/test-harness.ts';
const { tools } = makeHarness('/tmp');
const rows = [...tools.values()].map((tool) => ({
  name: tool.name,
  bytes: Buffer.byteLength(JSON.stringify({
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
  })),
}));
console.log(JSON.stringify({
  toolCount: rows.length,
  metadataBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
  rows: rows.sort((a, b) => b.bytes - a.bytes),
}, null, 2));
NODE
```

Observed baseline on 2026-07-18:

- tools: 21
- serialized metadata: 63,687 bytes
- largest definitions: ledger 6,365; worker-report 5,899; handoff 5,666; brief 5,615; breakout 5,288; worker 5,223; final-report 5,144 bytes.

Slice 00 records fresh output because tool descriptions may change before Slice 09.

## Local session-use evidence

Run:

```bash
rg -o '"toolName":"stardock_[^"]+"' /home/fl/.pi/agent/sessions --glob '*.jsonl' 2>/dev/null \
  | sed 's/.*"toolName":"\([^"]*\)"/\1/' \
  | sort | uniq -c | sort -nr
```

Observed relative counts included:

| Tool | Observed occurrences |
| --- | ---: |
| `stardock_worker` | 5,183 |
| `stardock_ledger` | 3,906 |
| `stardock_brief` | 3,558 |
| `stardock_state` | 2,225 |
| `stardock_auditor` | 1,505 |
| `stardock_worker_report` | 1,163 |
| `stardock_policy` | 1,157 |
| `stardock_final_report` | 1,116 |
| `stardock_governor_state` | 988 |
| `stardock_done` | 875 |
| `stardock_breakout` | 29 |
| `stardock_handoff` | 15 |
| `stardock_attempt_report` | 6 |
| `stardock_govern` | 2 |

No `stardock_brief_worker` or `stardock_advisory_adapter` occurrence appeared in this corpus. Counts are occurrence evidence across local session files, not unique-user analytics; branching, copied sessions, or subagent records can repeat calls. Use them to prioritize migration and activation, not as sole removal authority.

## State inventory

Run before Slices 06–08:

```bash
python - <<'PY'
from pathlib import Path
import json
root = Path('/home/fl/code')
rows = []
flat = []
errors = []
for directory in root.rglob('.stardock'):
    if not directory.is_dir():
        continue
    flat.extend(str(path) for path in directory.glob('*.state.json'))
    for path in directory.rglob('state.json'):
        try:
            raw = json.loads(path.read_text())
            rows.append({
                'path': str(path),
                'schemaVersion': raw.get('schemaVersion'),
                'mode': raw.get('mode'),
                'modeKind': (raw.get('modeState') or {}).get('kind'),
                'hasActive': 'active' in raw,
                'archived': '/archive/' in str(path),
            })
        except Exception as error:
            errors.append({'path': str(path), 'error': str(error)})
print(json.dumps({'nested': rows, 'flat': flat, 'errors': errors}, indent=2))
PY
```

Observed summary on 2026-07-18:

- nested state files: 25
- archived state files: 0
- flat state files: 0
- evolve state files: 0
- parse errors: 0
- current files containing `active`: 25

The full path list can expose private project names; store the execution artifact outside model-facing summaries and record only its path plus aggregate counts in Stardock evidence.

## High-confidence source evidence

- `itemsPerIteration` is parsed, stored, migrated, documented, and tested, but prompt behavior only checks `> 0`; the numeric value is never rendered or used as a count.
- `defaultReflectInstructions()` has no caller.
- `outside-requests.ts` exports `appendOutsideRequestPromptSections()`, while `runtime/prompts.ts` defines and calls a separate local implementation; the export has no caller.
- `stardock_brief_worker` delegates directly to `executeStardockWorkerTool()` and is described as compatibility-only.
- `stardock_advisory_adapter` formats provider-specific payloads while direct `stardock_worker` execution and provider-neutral brief payloads already exist.
- `includeOverview` is exposed by mutation schemas but no first-party execution caller was found; `followupTool` can request state overview.
- `LoopState.active` is derived from `status` on writes and read only as migration fallback.
- new state writes use `.stardock/runs/<name>/state.json`; flat lookup exists only for compatibility.
- evolve startup is rejected, while production carries reserved types, normalization, policy, docs, and tests.

## Use from execution files

- Slice 00 reruns and records every baseline.
- Slices 04–05 use usage evidence with the public API gates in [`compatibility-matrix.md`](compatibility-matrix.md). State inventory is context only; Slices 06–08 do not preserve or migrate old runs.
- Slice 09 compares final tool metadata against the fresh Slice 00 artifact.
