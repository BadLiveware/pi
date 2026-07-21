# Stardock Evidence Baseline

## Purpose

Provide reproducible measurements and source anchors that execution slices use before changing status, compatibility, schemas, or tool activation.

## Treehouse baseline

Run from the repository root:

```bash
treehouse --version
treehouse status
test -f treehouse.toml && echo present || echo absent
treehouse get --help
treehouse return --help
treehouse destroy --help
```

Observed on 2026-07-21:

- `/usr/bin/treehouse` reported version `v2.0.0`.
- `treehouse status` reported no worktrees in the pool.
- The repository had no `treehouse.toml`; Slice 00b adds repo-safe `max_trees = 6` without executable hooks.
- `get` exposes durable `--lease` and `--lease-holder` options.
- `return` exposes an explicit destructive `--force` option, which Stardock must not use automatically.
- `destroy` is dry-run by default, requires `--yes` to execute, has no `--force` option, and requires explicit `--include-unlanded`, `--include-in-use`, or exact-target `--include-leased` flags for risky classes.
- Treehouse worktrees default to detached HEAD at the default branch, so every Stardock lane must explicitly reset to the frozen contract SHA and create a unique lane branch before execution.
- A disposable planning probe confirmed `status` emits a second-column `leased`/`available` state, `return` changes leased to available, and safe pool cleanup is `treehouse destroy . --all --yes`.

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

Observed baseline on 2026-07-21:

- tools: 21
- serialized metadata: 63,687 bytes
- largest definitions: ledger 6,365; worker-report 5,899; handoff 5,666; brief 5,615; breakout 5,288; worker 5,223; final-report 5,144 bytes.

Slice 09 compares its result with this fresh measurement.

## Local session-use evidence

Run:

```bash
rg -o '"toolName":"stardock_[^"]+"' /home/fl/.pi/agent/sessions --glob '*.jsonl' 2>/dev/null \
  | sed 's/.*"toolName":"\([^"]*\)"/\1/' \
  | sort | uniq -c | sort -nr
```

Observed on 2026-07-21:

| Tool | Observed occurrences |
| --- | ---: |
| `stardock_worker` | 5,598 |
| `stardock_ledger` | 4,004 |
| `stardock_brief` | 3,788 |
| `stardock_state` | 2,258 |
| `stardock_auditor` | 1,536 |
| `stardock_worker_report` | 1,244 |
| `stardock_policy` | 1,192 |
| `stardock_final_report` | 1,146 |
| `stardock_governor_state` | 1,034 |
| `stardock_done` | 894 |
| `stardock_outside_answer` | 268 |
| `stardock_outside_requests` | 185 |
| `stardock_start` | 182 |
| `stardock_complete` | 131 |
| `stardock_breakout` | 29 |
| `stardock_outside_payload` | 21 |
| `stardock_handoff` | 15 |
| `stardock_attempt_report` | 6 |
| `stardock_govern` | 2 |

No `stardock_brief_worker` or `stardock_advisory_adapter` occurrence appeared in this corpus.
Counts are occurrence evidence across local session files, not unique-user analytics; branching, copied sessions, or subagent records can repeat calls.
Use them to prioritize migration and activation, not as sole removal authority.

## State inventory

Run before Slices 06–08:

```bash
python - <<'PY'
from pathlib import Path
import json
root = Path('/home/fl/code')
counts = {'nested': 0, 'archived': 0, 'flat': 0, 'evolve': 0, 'parseErrors': 0, 'withActive': 0}
for directory in root.rglob('.stardock'):
    if not directory.is_dir():
        continue
    counts['flat'] += sum(1 for _ in directory.glob('*.state.json'))
    for path in directory.rglob('state.json'):
        counts['nested'] += 1
        if 'archive' in path.parts:
            counts['archived'] += 1
        try:
            raw = json.loads(path.read_text())
            if raw.get('mode') == 'evolve' or (raw.get('modeState') or {}).get('kind') == 'evolve':
                counts['evolve'] += 1
            if 'active' in raw:
                counts['withActive'] += 1
        except Exception:
            counts['parseErrors'] += 1
print(json.dumps(counts, sort_keys=True))
PY
```

Observed summary on 2026-07-21:

- nested state files: 27
- archived state files: 0
- flat state files: 0
- evolve state files: 0
- parse errors: 1 empty state file
- readable files containing `active`: 26

The command intentionally emits aggregate counts only, because full path lists can expose private project names.
Existing files are implementation context, not migration inputs or acceptance gates.

## Current state-code shape

The behavior-neutral fixture in `test/baseline-contracts.test.ts` starts a checklist loop through the public tool and records the current schema-v3 write contract.
The fixture asserts these top-level fields:

```text
active, advisoryHandoffs, auditorReviews, baselineValidations,
breakoutPackages, briefs, criterionLedger, finalVerificationReports,
governorState, itemsPerIteration, iteration, lastReflectionAt,
maxIterations, mode, modeState, name, outsideRequests, reflectEvery,
reflectInstructions, schemaVersion, startedAt, status, taskFile,
verificationArtifacts, workerReports, workerRuns
```

The checklist `modeState` currently contains only `kind`.
This fixture is a pre-cutover deletion baseline for Slice 06, not a compatibility promise for old run files.

## Reference inventory

Run from the repository root to reproduce the bounded reference set:

```bash
for term in \
  defaultReflectInstructions appendOutsideRequestPromptSections \
  stardock_brief_worker stardock_advisory_adapter \
  includeOverview includeState includePromptPreview \
  itemsPerIteration 'schemaVersion: 3' existingStatePath evolve
 do
  printf '%s\n' "--- $term"
  rg -l "$term" \
    agent/extensions/private/stardock/src \
    agent/extensions/private/stardock/test \
    agent/extensions/private/stardock/README.md \
    agent/extensions/private/stardock/skills/stardock/SKILL.md \
    agent/agents agent/skills .pi/plans/stardock-*.md \
    .pi/plans/stardock-visibility-simplification 2>/dev/null | sort
 done
```

Fresh review on 2026-07-21 found:

| Surface | Current first-party reference result |
| --- | --- |
| `stardock_stage`, ExecutionGraph, stage/node state | No production or current test definition exists; references are confined to the visibility-simplification plan that will add them. |
| Dead prompt helpers | `defaultReflectInstructions()` is defined only in `src/runtime/prompts.ts`; no caller was found. `src/outside-requests.ts` exports `appendOutsideRequestPromptSections()`, while `src/runtime/prompts.ts` defines and calls a separate local helper; no caller of the export was found. |
| `/stardock status`, `/stardock list --archived`, pause, force-complete | `src/runtime/commands.ts` owns all current command handlers. The exact baseline semantics are covered by `test/baseline-contracts.test.ts`. |
| `stardock_brief_worker` | Defined in `src/brief-worker-runs.ts`; readiness policy, README, extension skill, global subagent-delegation skill, focused tests, and historical plans reference it. No local session invocation was observed. |
| `stardock_advisory_adapter` | Defined in `src/advisory-adapters.ts`; README, extension skill, focused tests, and historical plans reference it. No local session invocation was observed. |
| `includeOverview` | Exposed by handoff, auditor, breakout, brief, final-report, ledger, and worker-report production modules and documented in README/skill; no first-party execution caller was found. |
| `includeState` | Exposed by mutation and completion modules, used by current prompt/workflow recommendations, README/skill, and focused tests. |
| `includePromptPreview` | Exposed by brief mutation, documented in README/skill, and covered by brief tests; no first-party execution caller was found. |
| `LoopState.active`, `itemsPerIteration`, schema v3 | Runtime start/commands, state core/migration/store, prompts/arguments, skills, and tests reference the current fields. `active` is derived on every save; `itemsPerIteration` only gates a generic prompt cue. |
| Reserved evolve model/state | Production references remain in core tools, prompt/mode/state/migration modules, policy, README, and focused tests; startup rejects the reserved mode. |
| Flat `.stardock/*.state.json` layout | Compatibility lookup/list/delete references remain in state paths/store, runtime hooks/commands/tools, and views. No flat files were found in the aggregate inventory. |
| Low-frequency auditor/breakout/handoff/attempt tools | Production registration, policy/workflow routing, README/skill, and focused tests reference them. Local session evidence is low but nonzero. |
| Historical plans/diagrams | `stardock-implementation-framework.md`, `stardock-subagent-recursive-mode.md`, and `stardock-evolve-mode.md` contain removal-candidate names and require superseded notices when those public surfaces are removed. |

Zero observed session use or no in-repository caller is evidence about this bounded corpus, not proof that external callers do not exist.

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
