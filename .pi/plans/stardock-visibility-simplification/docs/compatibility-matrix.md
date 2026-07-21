# Stardock Surface and Cutover Matrix

## Purpose

Separate public API compatibility from disposable pre-change run state. Public tool/parameter removals require replacement evidence and explicit approval. Existing active, paused, completed, archived, evolve, flat-layout, and mixed-version run state has no compatibility guarantee and is restarted rather than migrated.

## Matrix

| Surface | Target disposition | Gate | Rollback |
| --- | --- | --- | --- |
| `stardock_stage` | Add through Slices 00a–00e; keep in active-loop core. | Graph/resource/ownership/Treehouse/fan-in/recovery tests and disposable dogfood. | Before downgrade, finish/abandon stages, return leases, discard run state, and restart. Older writers must not touch new stage state. |
| ExecutionGraph/stage/node state | Current-version schema only; preserve within schema v4, not across downgrade. | Current-version round-trip and nonterminal lifecycle gates. | Discard/restart; mixed-version preservation is unsupported. |
| Repository `treehouse.toml` | Add `max_trees = 6`, no executable hooks. | Fake adapter and disposable lease/return smoke. | Remove only after leases return. |
| Dead prompt helpers | Delete in Slice 03 after reference checks. | Typecheck/prompt tests prove no caller. | Restore/consolidate if a current caller appears. |
| `/stardock status` and unflagged `/stardock list` | Share one list-all implementation. | Command tests preserve aliases and archived behavior. | Restore separate handlers. |
| Pause/abandon command vocabulary | Add explicit names; retain existing aliases during this plan. | Help/tests distinguish resumable pause from terminal abandon. | Keep old aliases. |
| `stardock_brief_worker` | Migrate first-party callers in Slice 04; delete in Slice 05. | Policy, prompts, skills, profiles, tests, and current docs use `stardock_worker`; explicit user approval. | Re-register wrapper. |
| `stardock_advisory_adapter` | Replace needed payload inspection with canonical worker/brief behavior; delete in Slice 05. | Replacement tests and explicit user approval. | Restore adapter. |
| `includeOverview`, `includeState`, `includePromptPreview` | Replace with `followupTool`, explicit reads, or bounded brief preview; delete in Slice 05. | All first-party callers migrated, prompt behavior passes, explicit user approval. | Restore parameters. |
| Batch/single mutation ergonomics and artifact/status aliases | Keep. | No removal planned. | Not applicable. |
| `LoopState.active`, `itemsPerIteration`, schema `<4` | Hard-remove in Slice 06. Old runs are unsupported and rejected/discarded. | No active stage/lease; durable plan checkpoint; fresh schema-v4 continuation loop and current-state tests. | Restore code only, discard/restart state. No old-state reader. |
| Reserved evolve model/state | Delete in Slice 07. No legacy detector or migration. | Current checklist/recursive tests and source absence check. | Restore code only; no run-state preservation. |
| Flat `.stardock/*.state.json` layout | Delete lookup/list/delete/import compatibility in Slices 08/08a. | Current nested schema-v4 tests and source absence check. | Restore code only; no import/backup requirement. |
| Historical plans/diagrams | Mark removed public APIs as superseded so repository searches do not teach invalid calls. Old state examples need no migration guidance. | Current docs point to current contracts; removed public calls are clearly historical. | Restore notices/links from git. |
| Low-frequency auditor/breakout/handoff/attempt tools | Keep capability; lazy-load where appropriate. | Loader/policy discoverability tests. | Return to always-active registration. |

## Public API removal gate

Before deleting a public tool or parameter:

1. Search source, tests, README, skills, `agent/agents/`, prompts, architecture docs, and repository plans.
2. Add and validate the canonical replacement before deletion.
3. Present removed names, replacement calls, local usage evidence, unknown external-caller risk, and code rollback.
4. Record explicit user go/no-go approval.
5. Keep the preceding code commit independently revertible until full tests and live dogfood pass.

This gate does not apply to pre-change persisted run state, schema readers, evolve state, or flat layouts.

## New-state-only cutover

- Slice 06 proceeds only after Treehouse stages are terminal and leases returned.
- Export the implementation position and compact evidence to durable plan/artifact files, then discard pre-v4 `.stardock` state.
- Missing/pre-v4 schema is rejected with concise reset/restart guidance; it is never partially normalized or rewritten.
- Start a fresh schema-v4 continuation loop at Slice 06a.
- Downgrade to an older Stardock writer is unsupported after cutover; finish current work and discard/restart state first.

## Documentation disposition

- Current README, skill, tool schemas, capability profiles, and architecture docs change with behavior.
- Historical artifacts receive superseded notices for removed public calls when repository search could mislead future agents. They do not require old-run migration instructions.

## Use from execution files

- Slices 03–05 cite public API rows before removal.
- Slices 06–08 follow the new-state-only cutover, not a compatibility gate.
- Slice 09 must not reintroduce removed names to simplify loader grouping.
