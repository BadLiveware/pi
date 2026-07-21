# Stardock Tool Taxonomy and Dynamic Loading

## Purpose

Reduce the globally active Stardock tool-schema surface without hiding capabilities, breaking policy recommendations, or replacing clear vertical-slice tools with one oversized action schema.

## Current baseline

The extension registers 21 tools. The test-harness serialization of descriptions, parameters, prompt snippets, and prompt guidelines is approximately 63,687 bytes. The largest definitions are ledger, worker report, handoff, brief, breakout, worker, and final report.

Low call frequency is evidence for activation strategy, not automatic evidence for deletion. Auditor, breakout, final-report, attempt-report, and outside-request capabilities correspond to real workflow states even when uncommon.

## Decision

Stabilize the final public taxonomy first, then keep a small discoverable core active and register specialized tools as inactive until loaded.

### Always-active discovery/core

- `stardock_start`
- `stardock_state`
- `stardock_load_tools` (new additive capability router)

### Active-loop core

When a loop is active, add these tools without removing the always-active core:

- `stardock_done`
- `stardock_complete`
- `stardock_brief`
- `stardock_ledger`
- `stardock_worker`
- `stardock_stage`
- `stardock_policy`

### Specialized groups

| Group | Tools after simplification | Activation trigger |
| --- | --- | --- |
| Governance | governor-state and consolidated outside-request/govern actions that survive Slice 05 | User query, pending governor request, or policy recommendation. |
| Verification | final-report and auditor tools | Workflow enters final-verification/auditor states or explicit load request. |
| Breakout | breakout tool | Workflow requests breakout decision or explicit load request. |
| Recursive | attempt-report tool | Active loop mode is recursive or explicit load request. |
| Advisory evidence | worker-report and handoff tools that survive taxonomy cleanup | Explicit evidence/report request or recommendation referencing them. |
| Parallel execution | `stardock_stage` stays in active-loop core; Treehouse adapter details are not separate model tools | Active loop or explicit stage query. |

The execution slice must use the actual final names after Slices 04–05; this document defines roles, not permission to preserve superseded names.

## Loader contract

`stardock_load_tools` accepts a capability query or explicit supported group and returns:

- matched groups;
- tools already active;
- tools newly activated;
- concise reasons;
- the current active Stardock tool set.

The loader:

- searches only registered Stardock tools;
- performs additive activation during a turn so Pi can use native deferred tool loading when supported;
- preserves built-in and other-extension active tools;
- never disables tools during an active model turn;
- gives a clear no-match response with valid group names;
- remains active for the session.

## Automatic activation

At session start/reload:

- inspect the current active loop;
- activate active-loop core tools when needed;
- activate recursive tools for recursive mode;
- activate tools directly required by the current workflow gate or a pending outside request.

Before a policy/status response recommends a specialized tool, ensure that tool is active or recommend `stardock_load_tools` with exact arguments. A recommendation must never name an unavailable tool without a one-step discovery path.

## Followup behavior

`followupTool` is an internal read-only dispatch registry, not a model tool call. It may continue to execute supported read-only followups even when the corresponding public tool is inactive. Its returned content must state the public tool/group to load when the next action requires direct mutation.

Tests must cover:

- followup to an inactive evidence capability;
- policy recommendation that auto-activates or routes through the loader;
- active-loop resume and reload;
- model request immediately after additive activation;
- unknown group/query;
- preservation of non-Stardock active tools.

## Activation lifecycle

Tool removal is not required during the same active session. Add tools as capabilities become relevant and reset to the baseline set on a new/reloaded session. This favors prompt-prefix stability and avoids oscillation.

## Why not one mega-tool

A single `stardock_manage` schema would retain most metadata, weaken action-specific descriptions, enlarge validation unions, and concentrate unrelated mutation contracts. Dynamic loading preserves vertical-slice ownership and only pays schema cost when a capability becomes relevant.

## Measurement

Slice 09 records:

- registered Stardock tool count;
- initial active Stardock tool count and serialized metadata bytes with no active loop;
- active-loop core count/bytes;
- each specialized group's incremental bytes;
- successful discovery and execution scenarios.

Acceptance requires a material initial reduction from 63,687 bytes. The slice should target at least a 60% reduction for no-active-loop startup and report the measured result rather than weakening discoverability to meet the target.

## Rollback

Keep all tools registered. Rollback consists of restoring the all-registered-tools active set and removing the loader/activation policy; no state migration is required.

## Execution relationship

- Tool names and removals are settled by Slices 04–05.
- Dynamic activation is implemented by [`../slices/09-dynamic-tool-loading.md`](../slices/09-dynamic-tool-loading.md).
