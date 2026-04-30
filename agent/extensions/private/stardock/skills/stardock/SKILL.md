---
name: stardock
description: Use when starting, driving, or inspecting private Stardock implementation loops: checklist loops for finite work, recursive bounded attempts, governor/outside request workflows, and evidence-backed multi-iteration progress. Avoid for simple one-shot tasks or quick fixes.
---

# Stardock

Stardock is a private Pi implementation framework for governed agentic work. Current capabilities are checklist and recursive loops, a criterion ledger, compact verification artifact refs, manual IterationBrief context packets, final verification reports, and manual/data-only auditor reviews; future work will add stronger completion policy and bounded worker handoffs.

Use `stardock_start` to begin a loop. Choose `mode: "checklist"` for finite known work or `mode: "recursive"` for bounded try/test/reset attempts on open-ended objectives:

```js
stardock_start({
  name: "loop-name",
  mode: "checklist",
  taskContent: "# Task\n\n## Goals\n- Goal 1\n\n## Checklist\n- [ ] Item 1\n- [ ] Item 2",
  maxIterations: 50,
  itemsPerIteration: 3,
  reflectEvery: 10
})
```

Recursive mode requires an `objective` and may include `baseline`, `validationCommand`, `resetPolicy`, `stopWhen`, `maxFailedAttempts`, `outsideHelpEvery`, `governEvery`, and `outsideHelpOnStagnation`.

## Workflow

1. Prepare clear task content with goals, checklist/criteria, and validation expectations.
2. Start the loop with `stardock_start`; it creates `.stardock/runs/<name>/task.md` from `taskContent`.
3. While a loop is active, use the Stardock widget for at-a-glance status; use `/stardock view [loop]` or `stardock_state({ loopName, view: "overview" })` when the user asks what is happening in more detail; use `view: "timeline"` or `/stardock timeline [loop]` when they want the event sequence.
4. Work one bounded iteration.
5. Record progress and verification evidence in the task file.
6. For recursive loops, use `stardock_attempt_report` when available.
7. Call `stardock_done` to proceed to the next iteration. If the active brief is finished, pass `briefLifecycle: "complete"`; if it should be deactivated but remain draft, pass `briefLifecycle: "clear"`; omit it to keep existing behavior.
8. Output `<promise>COMPLETE</promise>` only when the scoped work is done.

Use `stardock_ledger` when criteria or evidence need to be durable: `upsertCriterion` records one stable acceptance criterion, `upsertCriteria` seeds or updates several criteria in one call, `recordArtifact`/`recordArtifacts` store compact refs to tests/smoke checks/screenshots/logs/benchmarks, and `list` shows the ledger without reading `.stardock/` files. Keep long logs and screenshots outside state; store paths and concise summaries. Prefer `includeState: true` or `includeOverview: true` when that avoids an immediate follow-up state call.

Use `stardock_brief` when the next iteration should follow a selected context packet: `upsert` creates or updates a brief, `activate` makes it appear in subsequent loop prompts, `clear` returns the loop to the normal prompt shape, and `complete` records that the brief is done. For the common create-and-use path, pass `activate: true`; add `includeState: true` or `includePromptPreview: true` when you need to verify the effective state or prompt shape in the same response. Briefs default to `source: "manual"`; use `source: "governor"` and optional `requestId` only when a governor review explicitly selected that bounded context. Briefs are data-only routing hints; they do not spawn subagents, distill plans automatically, activate silently, or replace validation. Use `stardock_done({ briefLifecycle: "complete", includeState: true })` after a bounded iteration has satisfied the active brief, or `briefLifecycle: "clear"` when the brief should stop routing prompts but remain draft.

Use `stardock_final_report` before claiming substantial work complete when criteria/evidence/gaps need a durable summary. `record` stores a compact manual report with status, summary, covered `criterionIds`, referenced `artifactIds`, validation records, unresolved gaps, and compatibility/security/performance notes; `list` inspects reports without reading `.stardock` files. Reports are optional evidence summaries in this slice: they do not run validators, call models, spawn auditors, or block completion automatically.

Use `stardock_auditor` when a bounded oversight review should inspect criteria, artifacts, final reports, attempts, and governor/outside-request context. `payload` builds a ready-to-copy manual auditor task; `record` stores a compact result with status, summary, focus, linked criteria/artifacts/final reports, concerns, recommendations, and required follow-ups; `list` inspects reviews. Auditor reviews are data-only in this slice: Stardock does not call a model, spawn subagents, mutate implementation state, or block completion automatically.

Use `stardock_handoff` when work should be packaged for a human, agent, model, CLI, or future provider adapter without binding Stardock to that provider. `payload` builds a provider-neutral task, `record` stores the compact returned result, and `list` inspects handoffs. Treat `provider` metadata as optional and opaque; do not make provider session IDs or transcript formats the source of truth. This is a decoupling firewall, not execution: Stardock does not call `pi-subagents`, spawn agents, run models/processes, or apply returned edits.

Use `stardock_breakout` when a loop is stuck, blocked, repeatedly failing criteria, or cannot honestly complete without a decision. `payload` builds a compact decision package, `record` stores the package, and `list` inspects packages. Link criteria, attempts, artifacts, final reports, auditor reviews, advisory handoffs, and outside requests when they explain why the loop is blocked. Keep last errors, suspected root causes, requested decision, resume criteria, and next actions compact. Breakout packages are data-only evidence handoffs: they do not call models, spawn agents, run processes, trigger escalation, apply edits, or block completion automatically.

Use `stardock_policy({ action: "completion" })` before claiming substantial work complete or when deciding whether more evidence/review is warranted. It is read-only and returns recommendation findings with rationales, linked evidence, and suggested tools. Treat the result as guidance: it does not mutate state, enforce gates, call models, spawn agents, run processes, apply edits, or replace judgment. Follow its recommendations with explicit tool calls only when they fit the scope.

If outside-help/governor requests appear, inspect them with `stardock_outside_requests`, fetch ready-to-copy work with `stardock_outside_payload`, satisfy them manually or with a parent/orchestrator workflow, then record answers with `stardock_outside_answer`. Use `stardock_govern` for an immediate manual governor review request and payload without spawning subagents. Stardock keeps governor requests to one per iteration, so a manual governor request/decision suppresses the automatic cadence request for that same iteration.

## Commands

- `/stardock start <name|path> [--mode checklist|recursive]` — start a loop.
- `/stardock resume <name>` — resume a paused loop.
- `/stardock stop` — pause the current loop when idle.
- `/stardock-stop` — stop active loop when idle.
- `/stardock status` — show loops.
- `/stardock view [loop] [--archived]` — show run overview, progress, latest governor decision, and timeline.
- `/stardock timeline [loop] [--archived]` — show only the run timeline.
- `/stardock list --archived` — show archived loops.
- `/stardock govern [loop]` — create a manual governor review request and payload.
- `/stardock outside [loop]` — show outside-help/governor requests.
- `/stardock outside payload <loop> <request-id>` — show a ready-to-copy governor/researcher task payload.
- `/stardock outside answer <loop> <request-id> <answer>` — record a plain-text outside request answer.
- `/stardock archive <name>` — move loop to archive.
- `/stardock clean [--all]` — clean completed loops.
- `/stardock cancel <name>` — delete loop.
- `/stardock nuke [--yes]` — delete all `.stardock` data.

Press ESC to interrupt streaming, send a normal message to resume, and run `/stardock-stop` when idle to end the loop.

## Task file shape

```md
# Task Title

Brief description.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2
- [x] Completed item

## Verification
- Evidence, commands run, or file paths

## Notes
(Update with progress, decisions, blockers)
```

## Guidance

- Keep each iteration bounded.
- Record evidence before claiming progress.
- Prefer project-native validation commands.
- Use governor/outside requests to break out of local-lane fixation.
- Do not preserve `ralph_*`, `/ralph`, or `.ralph/` compatibility unless explicitly useful for local migration.
