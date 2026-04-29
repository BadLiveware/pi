---
name: planning
description: Use when work is large, risky, or multi-step enough that you should sequence changes, validation, and any preparatory refactors before editing code.
---

# Planning

Use this skill to turn explicit requirements into an executable, validated plan before editing code. Decide whether the work is bounded or unbounded, simple or split/long, then read the matching reference when more detail is needed. If the plan is already clear and the next job is execution, switch to `execute-plan`.

## When to Use
Use when work is large, risky, multi-step, needs sequencing, separates refactors from behavior changes, needs validation design, depends on prior/external evidence, or would benefit from task tracking/delegation.

If purpose, scope, or requirements are ambiguous, use `requirements-discovery` first.

## Shape Decision
Infer the work shape from the user's intent and success semantics; do not wait for the user to say "bounded" or "unbounded".

- **Bounded**: the request has a finite desired end state, a checklist can be completed, and success means the planned change is done. Use a normal plan under `.pi/plans/`.
- **Unbounded**: the request implies ongoing improvement, repeated attempts, replenishing from evidence, optimizing/tuning/hardening over time, avoiding local maxima, or continuing until the user stops. Read `unbounded-work.md` and create a compact project-owned loop file under `.pi/loops/<loop-name>/loop.md`.
- **Simple vs split/long**: use a single plan for normal bounded work; use a split plan directory when the bounded plan is too large, spans many reviewable implementation areas, or would overload execution context.

Common unbounded signals include: "keep improving", "iterate", "loop", "optimize", "tune", "try ideas", "measure and accept/reject", "continue until stopped", "don't stop at a finite backlog", or work where failed attempts should prevent retracing paths.

If a prompt mixes continuous/open-ended intent with "quick" or "finite for now" convenience pressure, treat it as unbounded unless the user explicitly asks for a bounded pilot.

## Plan Location
For bounded plans, write under `.pi/plans/`:
- simple plan: `.pi/plans/<short-hyphenated-name>.md`
- deep plan: `.pi/plans/<short-hyphenated-name>/README.md` plus numbered files such as `01-evidence.md`, `02-implementation.md`

For unbounded loop charters, write the canonical live context under `.pi/loops/<loop-name>/loop.md` and keep plan paths, if any, as pointers only.

Names should describe the domain work, not generic labels like `simple_plan`, `phase2`, or `deep_plan`.

## Purpose Anchoring
Do not invent product or architectural purpose from terse prompts like "make a long plan". Those control format/depth, not goal or scope.

Anchor purpose only in explicit user instructions, referenced files/issues/docs/plans, verified relevant repository evidence, or clearly labeled assumptions. If multiple purposes are plausible, ask one concise high-leverage question or offer 2-3 one-line directions with a recommendation. If the user insists on proceeding without clarity, make purpose discovery the first plan task instead of presenting guessed implementation work as settled.

## Plan Quality Contract
A non-trivial plan should be executable by a future agent without guessing. Include:
- anchored purpose, desired end state, scope, non-goals, assumptions, and constraints
- observed facts vs user-stated requirements vs assumptions
- affected files/areas when knowable
- ordered leaf tasks with coherent outcomes, acceptance criteria, and validation
- risks, rollback points, side effects, approval gates, and compatibility/data-safety concerns
- for scale-sensitive work, a performance shape: work units, expected scale, caps/cancellation, repeated work to avoid, and measurement or smoke validation
- exact validation commands or inspection checks with expected signals; if unknown, add discovery work
- targeted comment/docs work for non-obvious, compatibility-driven, or required-by-X code

No hidden placeholders: `TODO`, `TBD`, `fill in later`, `similar to previous`, `add tests`, `handle edge cases`, `etc.`, or vague `document this` steps are not acceptable substitutes for required detail.

## Task Granularity
A leaf task is ready when it can be verified independently, touches one concern or explains why files change together, is a plausible commit boundary, has a clear done state, and can be reviewed without reading the whole plan.

TDD cycles happen inside implementation tasks. Do not split `write failing test`, `make it pass`, and `refactor` into separate plan tasks unless test infrastructure itself is the deliverable.

## Long Plan Splitting
Use a deep plan directory when a plan would be very long, spans many phases, or would overload execution context.

`README.md` is the master overview: purpose, execution order, dependency graph, global constraints, cross-cutting risks/rollback, final acceptance criteria, and overall validation strategy.

Each numbered file should be independently reviewable and implementation-sized, with local purpose/scope, prerequisites, affected areas, concrete implementation and validation tasks, compatibility/docs/cleanup work, exit criteria, and handoff notes. Split by coherent reviewable implementation boundaries, not arbitrary line count. Recommend `execute-plan`; it reads `../execute-plan/long-plan.md` for split/long bounded execution.

Detailed templates live in `output-templates.md`.

## Workflow
1. Capture requirements, non-goals, assumptions, constraints, public contracts, and current/desired behavior.
2. For terse or format-only prompts, anchor purpose or create discovery/intake tasks before implementation tasks.
3. Inspect affected code, generated artifacts, local guidance, and project-sanctioned validation commands.
4. For source-sensitive or evidence-heavy subjects, run focused Feynman research before freezing scope: `session-search`, `alpha-research`, `literature-review`, `source-comparison`, or `deep-research` as appropriate.
5. If working from an existing plan, isolate the current referenced document and immediate prerequisites.
6. For scale-sensitive paths, include a concise performance-shape note before task sequencing: what scales, what bounds it, and what representative validation will show.
7. Order independently validatable steps, separating preparatory refactors, behavior changes, validation, docs, migration, cleanup, and delegation points.
8. Choose domain-facing names; do not carry plan labels into code/docs/generated artifacts.
9. Decide bounded/unbounded and simple/split shape. For unbounded work, read `unbounded-work.md` and write a loop charter instead of a finite plan.
10. For bounded work, decide single-file vs split plan, then write concrete nested tasks rather than context-only prose.
11. Self-review for requirement coverage, task granularity, acceptance criteria, exact validation, missing affected areas, placeholders, and artifact hygiene. For high-risk plans, consider reviewer prompt `plan-quality-review.md`.
12. If task tools are useful, create only the next UI-scannable rolling window of roughly 5-8 active leaf tasks for bounded work or 1-3 active attempts for unbounded work; keep the rest in the plan/loop file.

## Task and Handoff Guidance
- Use `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate` for meaningful multi-step work.
- Task descriptions should include `Goal`, `Files / areas`, `Acceptance criteria`, `Validation`, and `Risks / notes` when useful.
- Use parent/container tasks only for coordination; leaf tasks hold coding, validation, migration, docs, and cleanup work.
- Treat the task list as execution scaffolding, not scope boundary. Add missing in-scope tasks when needed.
- When context or plan focus changes, reconcile tasks immediately; remove obsolete pending tasks and old completed tasks from irrelevant prior context.
- Delegate only bounded, low-coupling leaf tasks. For model choice and downshifting, use `subagent-delegation` and `list_pi_models`.
- Use `execute-plan` when the plan or loop charter is clear and execution should start.
- For split/long bounded plans, `execute-plan` should read `long-plan.md` before execution.
- If the user asked for planning only, stop at the plan instead of silently implementing.

## Status and Completion
- For ordered plan documents, stay on the current referenced document until its mandatory work and exit criteria are complete unless the user reprioritizes.
- Do not call scaffolding, observability, or partial groundwork done when required implementation remains.
- During execution, progress belongs in tasks/plan notes unless the user asked for status only, execution is complete, or a blocker requires a decision.

## Editing This Skill
When changing planning output formats or examples, update `output-templates.md` and behavior-test purpose anchoring, placeholder rejection, artifact hygiene, and split-plan handoff.
