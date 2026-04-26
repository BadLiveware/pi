# Unbounded Work Planning

Use this reference from `planning` when the work is open-ended and should continue until the user stops it, not until a finite checklist is exhausted.

## Outcome
- one compact project-owned canonical loop file with all live decision-critical context
- an explicit attempt cycle: check/measure current state -> select one candidate -> change or split/defer -> evaluate -> accept/reject/defer/split/block -> record/reset -> repeat
- artifact policy scaled to the loop: durable domain artifacts for long-term repo knowledge, or minimal anti-repeat notes for lightweight loops
- a context-compaction policy so future agents can resume without reading large history

## When Work Is Unbounded
Infer unbounded work from intent, not keywords. The user probably will not say "unbounded".

Treat work as unbounded when the request implies ongoing optimization, continuous tuning, autonomous improvement, repeated research/experimentation, open-ended hardening, iterative cleanup, benchmark-driven work, attempts that replenish from evidence, or stop conditions based on user interruption rather than checklist completion.

If the prompt mixes continuous/open-ended intent with pressure for a quick finite wrap, treat the unbounded intent as authoritative unless the user clearly changes scope to a bounded pilot.

## Canonical File Location
Default to a single project-owned canonical file:

```text
.pi/loops/<loop-name>/loop.md
```

Treat `.ralph/` files as runtime control artifacts for the Ralph extension: they may mirror or point to the canonical loop file, but they should not become durable source of truth.

Optional support files only when justified by the loop charter:
- `.pi/loops/<loop-name>/attempts/<attempt-id>.md` for current-attempt notes and verification summaries that are too bulky for the canonical file
- `.pi/loops/<loop-name>/attempt-archive.ndjson` for compact append-only historical summaries
- domain-specific negative-result docs for durable rejected/deferred lessons

For lightweight loops, the canonical file may be the only durable artifact; keep just enough anti-repeat memory to avoid retracing failed paths. For heavier loops, do not move bulky notes/verification into the canonical file; store them in per-attempt or domain artifacts and keep only pointers in the loop file.

## Single-Source-of-Truth Rule
Do not duplicate decision-critical content across project loop file, Ralph runtime file, plan summary, and plan files.

Choose one owner per fact:
- objective/protocol/thresholds/current state/active hypotheses/recent results -> canonical `.pi/loops/<loop-name>/loop.md`
- current-attempt bulky notes/verification -> per-attempt artifact such as `.pi/loops/<loop-name>/attempts/<attempt-id>.md`
- accepted implementation evidence -> commit and referenced artifacts when the loop uses commits
- rejected/deferred/split lessons -> independent negative-result artifacts only when they have durable domain value; otherwise compact anti-repeat notes in the canonical file are enough
- verbose raw outputs and old attempt details -> optional archive/artifact files only when useful

Other files should reference owner locations with short pointers, not copy content.

## Required Charter Sections
1. **Objective**: what improves, how it is judged, and direction of improvement when metric-based.
2. **Guardrails**: correctness, safety, compatibility, quality, cost, or scope constraints that must not regress.
3. **Evaluation Protocol**: exact commands, checks, inspections, or review criteria; include noise handling for measurements.
4. **Acceptance Rules**: what evidence is enough to keep a change.
5. **Rejection/Deferral/Split Rules**: when to revert, document, retry later, or split an attempt.
6. **Current State Snapshot**: current best known commit/config/result and latest trusted evidence.
7. **Active Context Window**: only the next 1-3 hypotheses and last 3-5 attempt summaries.
8. **Attempt Notes Policy**: where bulky per-attempt notes and verification evidence live, and what pointer stays in the canonical file.
9. **Artifact Policy**: which outcomes need durable domain artifacts, which only need compact anti-repeat notes, and where each belongs.
10. **Runner Policy**: use Ralph by default for execution when available; state whether the loop is attempt-driven or item-queue paced. For optimization/experiment loops, set one Ralph iteration to one full attempt and use `itemsPerIteration: 0`; if not using Ralph, record why and what runner/checkpoint mechanism replaces it.
11. **Compaction Policy**: when/how stale detail is archived while the canonical file stays small.
12. **Commit Policy**: how accepted kept state is committed or recorded when commit permission is active.
13. **Runtime Decision Policy**: all approval boundaries, cost ceilings, ambiguity handling, and fallback behavior needed during the loop must be decided before starting; the loop cannot rely on asking the user mid-iteration.
14. **Pause Rules**: pause only for explicit user stop, unrecoverable blockers under the predeclared policy, unsafe actions without preapproval, or agreed stop criteria.

## Planning Workflow
1. Anchor the open-ended goal and constraints from explicit user goals.
2. Identify trustworthy evaluation commands/checks before planning changes.
3. Define acceptance/rejection thresholds before proposing attempts.
4. Resolve runtime decision boundaries before loop start: approvals, cost limits, destructive/external actions, fallback choices, when to skip/defer, and what counts as unrecoverable.
5. Design the canonical loop file so a fresh agent can resume by reading one compact file.
6. For Ralph execution, define the iteration unit and pacing before start; optimization/experiment loops should use a reusable current-attempt checklist, reset it before `ralph_done`, and set `itemsPerIteration: 0`.
7. Seed only a short rolling idea queue (1-3 active, a few deferred), keeping scope unbounded.
8. Define compaction rules so stale detail is archived and active context stays small.
9. Ensure the plan is loop-shaped, not phase-shaped; do not claim completion after backlog exhaustion.
10. Recommend `execute-plan` for execution; it will read its unbounded execution reference.

## Compaction Pattern
Define a repeatable compaction command or manual procedure in the canonical file.

Suggested pattern:
- Trigger: every N attempts (for example every 5) or when canonical file exceeds a size target.
- Action: append old detailed rows/log references to archive, keep only last 3-5 summaries + current state + active hypotheses in canonical file.
- Record: add one short compaction event note with timestamp and archive pointer.

Example:

```text
Compaction command: ./scripts/loop-compact.sh .pi/loops/<loop-name>/loop.md .pi/loops/<loop-name>/attempt-archive.ndjson --keep 5
```

## Task Guidance
- Use tasks as a rolling execution window only; do not represent total loop scope as finite.
- Keep 1-3 active attempts/tasks visible and replenish continuously from backlog/evidence.
- For optimization, experiment, benchmark, hardening, or research loops, plan each Ralph iteration around one complete evaluated attempt: measure/select/do/measure/decide/commit accepted changes/update records/reset the runtime checklist.
- Use `itemsPerIteration: 0` for attempt-driven loops so Ralph does not treat individual checklist boxes as iteration boundaries.
- Use `itemsPerIteration: N` only for item-queue loops where each checklist item is a complete useful work unit.
- Allow up to 3 micro-attempts in one iteration only when each can be independently evaluated, logged, decided, and represented in the reset state.
