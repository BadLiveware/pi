---
name: planning
description: Use when work is large, risky, or multi-step enough that you should sequence changes, validation, and any preparatory refactors before editing code.
---

# Planning

Use this skill to turn explicit requirements into an executable, validated plan before editing code. Decide whether the work is bounded or unbounded, simple or split/long, then read the matching reference when more detail is needed. If the plan is already clear and the next job is execution, switch to `execute-plan`.

## When to Use
Use when work is large, risky, multi-step, needs sequencing, separates refactors from behavior changes, needs validation design, depends on prior/external evidence, or would benefit from task tracking/delegation.

If purpose, scope, or requirements are ambiguous, use `requirements-discovery` first. If task sequencing depends on a new or revised system shape, use `architecture-decision` before writing the implementation plan.

## Shape Decision
Infer the work shape from the user's intent and success semantics; do not wait for the user to say "bounded" or "unbounded".

- **Bounded**: the request has a finite desired end state, a checklist can be completed, and success means the planned change is done. Use a normal plan under `.pi/plans/`.
- **Unbounded**: the request implies ongoing improvement, repeated attempts, replenishing from evidence, optimizing/tuning/hardening over time, avoiding local maxima, or continuing until the user stops. Read `unbounded-work.md` and create a compact project-owned loop file under `.pi/loops/<loop-name>/loop.md`.
- **Simple vs split/long**: use a single plan for normal bounded work; use a split plan directory when the bounded plan is too large, spans many reviewable implementation areas, has reusable operational knowledge, or would overload execution context.

Common unbounded signals include: "keep improving", "iterate", "loop", "optimize", "tune", "try ideas", "measure and accept/reject", "continue until stopped", "don't stop at a finite backlog", or work where failed attempts should prevent retracing paths.

If a prompt mixes continuous/open-ended intent with "quick" or "finite for now" convenience pressure, treat it as unbounded unless the user explicitly asks for a bounded pilot.

## Plan Location
For bounded plans, write under `.pi/plans/`:
- simple plan: `.pi/plans/<short-hyphenated-name>.md`
- split plan: `.pi/plans/<short-hyphenated-name>/README.md` as the semantic contract, plus `work-breakdown.md` and optional supporting context folders

For unbounded loop charters, write the canonical live context under `.pi/loops/<loop-name>/loop.md` and keep plan paths, if any, as pointers only.

Names should describe the domain work, not generic labels like `simple_plan`, `phase2`, or `deep_plan`.

## Plan Topology
For broad bounded work, separate the durable semantic contract from implementation decomposition and transient runtime state.

Preferred split layout:
- `README.md`: the semantic source of truth—problem, domain concepts, current and desired behavior, invariants, scope, compatibility expectations, examples, and whole-change acceptance conditions. Keep execution order, worker topology, ownership allocation, retries, and commands out of it.
- `work-breakdown.md`: the complete implementation decomposition—work nodes, dependencies, semantic requirement references, ownership, per-node acceptance criteria, validation, bounds, and final combined-result checks.
- `work/`: optional deeper implementation context such as affected-area maps, algorithm notes, migration detail, or node-specific pitfalls. These files do not define ordering or delivery boundaries.
- `docs/`: reusable runbooks, validation workflows, compatibility maps, and reviewer expectations.
- `design/`: deferred or cross-cutting decisions that should not be mixed into the semantic contract or implementation decomposition.

Keep one owner for each fact. Whole-change semantics and observable outcomes belong in `README.md`; node topology and execution checks belong in `work-breakdown.md`; supporting files are referenced context. Do not duplicate mandatory tasks or acceptance criteria across files, and do not hide them in `docs/`, `design/`, or `work/`.

## Stardock DAG Design
For finite work with meaningful dependencies or independent jobs, use a Stardock DAG rather than a serial worker sequence. Model research, shared setup, interfaces, schemas, migrations, contracts, and decisions as executable prerequisites when later jobs consume their outputs; expose every independent child for fan-out after its dependencies are accepted.

Stardock nodes are arbitrary jobs, not PR/branch/delivery boundaries or mandatory code producers. A node may return a report, findings, throw-away test results, artifacts, commits, or no filesystem changes. If combined code, promotion, delivery, or release is part of the requested work, model it as an explicit dependent node; do not assume every accepted wave must be merged into the original workspace.

Each node should state its objective, bounded task, dependencies, and observable acceptance criteria. Add reads, owned writes, resource claims, validation commands, and attempt bounds only when they apply. Independent write-producing nodes must own disjoint writes/resources; add a dependency, split ownership, or create an explicit combining node when they conflict. A width-one ready set is naturally serial and needs no special workflow.

Plan the governor-facing lifecycle as `stardock_plan → stardock_run → stardock_review`, repeated or redirected according to governor decisions. Include retry, abandon, supersession, explicit promotion nodes, or optional compatibility integration where the work requires them. Keep worker transport, leases, internal graph records, exact Git identities, cleanup, and recovery protocol out of the plan unless those mechanics are themselves in scope.

## Purpose Anchoring
Do not invent product or architectural purpose from terse prompts like "make a long plan". Those control format/depth, not goal or scope.

Anchor purpose only in explicit user instructions, referenced files/issues/docs/plans, verified relevant repository evidence, or clearly labeled assumptions. If multiple purposes are plausible, ask one concise high-leverage question or offer 2-3 one-line directions with a recommendation. If the user insists on proceeding without clarity, make purpose discovery the first plan task instead of presenting guessed implementation work as settled.

## Plan Quality Contract
A non-trivial plan should be executable by a future agent without guessing. Include:
- anchored purpose, desired end state, scope, non-goals, assumptions, and constraints
- observed facts vs user-stated requirements vs assumptions
- affected files/areas when knowable
- ordered leaf tasks with coherent outcomes, acceptance criteria, and validation
- for split plans, a semantic `README.md` separated from a complete `work-breakdown.md` and optional supporting context
- risks, rollback points, side effects, approval gates, and compatibility/data-safety concerns
- for scale-sensitive work, a performance shape: work units, expected scale, caps/cancellation, repeated work to avoid, and measurement or smoke validation
- exact validation commands or inspection checks with expected signals; if unknown, add discovery work
- targeted comment/docs work for non-obvious, compatibility-driven, or required-by-X code

No hidden placeholders: `TODO`, `TBD`, `fill in later`, `similar to previous`, `add tests`, `handle edge cases`, `etc.`, or vague `document this` steps are not acceptable substitutes for required detail.

## Task Granularity
A leaf task is ready when it can be verified independently, touches one concern or explains why files change together, is a plausible commit boundary, has a clear done state, and can be reviewed without reading the whole plan.

TDD cycles happen inside implementation tasks. Do not split `write failing test`, `make it pass`, and `refactor` into separate plan tasks unless test infrastructure itself is the deliverable.

## Long Plan Splitting
Use a split plan directory when semantics, implementation decomposition, and reusable supporting knowledge would make one document difficult to understand or execute.

`README.md` is the durable semantic contract. It explains what the change means without embedding phase order, DAG mechanics, worker instructions, ownership allocation, retry policy, or command lists. A maintainer should still find it useful after implementation is complete.

`work-breakdown.md` is the implementation contract. It maps bounded work nodes to sections of the semantic README, states dependencies and ownership, defines per-node acceptance and validation, and carries any Stardock-ready topology. Optional `work/` files add deeper context but do not own mandatory tasks or execution order. Store reusable runbooks in `docs/` and deferred/cross-cutting decisions in `design/`.

Use `prs/` only for an explicitly requested multi-PR delivery workflow. When execution will use Stardock, derive the complete DAG from `work-breakdown.md`, author large graphs incrementally as a draft, and seal before execution; do not make semantic README or context-file boundaries double as execution nodes or authoring batches. Recommend `execute-plan`; it reads `../execute-plan/long-plan.md` for split/long bounded execution.

Detailed templates live in `output-templates.md`.

## Workflow
1. Capture requirements, non-goals, assumptions, constraints, public contracts, and current/desired behavior.
2. For terse or format-only prompts, anchor purpose or create discovery/intake tasks before implementation tasks.
3. Inspect affected code, generated artifacts, local guidance, and project-sanctioned validation commands.
4. For source-sensitive or evidence-heavy subjects, run focused Feynman research before freezing scope: `session-search`, `alpha-research`, `literature-review`, `source-comparison`, or `deep-research` as appropriate.
5. If working from an existing plan, isolate the current referenced document and immediate prerequisites.
6. For scale-sensitive paths, include a concise performance-shape note before task sequencing: what scales, what bounds it, and what representative validation will show.
7. Order independently validatable steps, separating preparatory refactors, behavior changes, validation, docs, migration, cleanup, and delegation points.
8. Do not let sequencing turn preparatory work into a parking lot for the real change. When a risky or invasive behavior change is in scope, plan the testability/instrumentation work that makes it safe, then include the completion step for the actual behavior in the same execution path.
9. For broad plans, write the semantic contract in `README.md`, put implementation decomposition in `work-breakdown.md`, and move reusable runbooks/maps/design notes into supporting folders.
10. Choose domain-facing names; do not carry plan labels into code/docs/generated artifacts.
11. Decide bounded/unbounded and simple/split shape. For unbounded work, read `unbounded-work.md` and write a loop charter instead of a finite plan.
12. For bounded work, decide single-file vs split plan, then write concrete nested tasks rather than context-only prose.
13. Self-review for requirement coverage, task granularity, acceptance criteria, exact validation, missing affected areas, placeholders, plan topology, Stardock handoff shape, and artifact hygiene. For high-risk plans, consider reviewer prompt `plan-quality-review.md`.
14. If task tools are useful, create only the next UI-scannable rolling window of roughly 5-8 active leaf tasks for bounded work or 1-3 active attempts for unbounded work; keep the rest in the plan/loop file.

## Task and Handoff Guidance
- Use `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate` for meaningful multi-step work.
- Task descriptions should include `Goal`, `Files / areas`, `Acceptance criteria`, `Validation`, and `Risks / notes` when useful.
- Use parent/container tasks only for coordination; leaf tasks hold coding, validation, migration, docs, and cleanup work.
- Treat the task list as execution scaffolding, not scope boundary. Add missing in-scope tasks when needed.
- When context or plan focus changes, reconcile tasks immediately; remove obsolete pending tasks and old completed tasks from irrelevant prior context.
- Delegate only bounded, low-coupling leaf tasks. For model choice and downshifting, use `subagent-delegation` and `list_pi_models`.
- Use `execute-plan` when the plan or loop charter is clear and execution should start.
- For split/long bounded plans, `execute-plan` should read `long-plan.md` before execution.
- For Stardock-backed bounded execution, derive declarative DAG nodes from `work-breakdown.md` and actual work dependencies—not from README sections, planning-file boundaries, or incremental authoring batches. Large graphs may be upserted in bounded groups, but the sealed DAG remains the execution contract. Let Stardock derive internal briefs and evidence records.
- For an existing or explicitly requested legacy recursive Stardock loop, plan each iteration as one complete evaluated attempt and use its restored attempt evidence tools. Do not recommend legacy recursive Stardock by default for new unbounded work.
- If the user asked for planning only, stop at the plan instead of silently implementing.

## Status and Completion
- For ordered plan documents, stay on the current referenced document until its mandatory work and exit criteria are complete unless the user reprioritizes.
- Do not call scaffolding, observability, or partial groundwork done when required implementation remains.
- When a plan contains enabling testability/instrumentation work, pair it with the downstream behavior change it unlocks unless a real blocker or explicit user decision splits them.
- During execution, progress belongs in tasks/plan notes unless the user asked for status only, execution is complete, or a blocker requires a decision.

## Editing This Skill
When changing planning output formats or examples, update `output-templates.md` and behavior-test purpose anchoring, placeholder rejection, artifact hygiene, and split-plan handoff.
