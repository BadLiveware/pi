---
name: subagent-delegation
description: Use when considering whether to delegate bounded work for parallelism, independent review, routine work on a cheaper or faster enabled model, or hard narrow work on a stronger enabled model.
---

# Subagent Delegation

Use this skill to decide whether to delegate, what to delegate, and which supported enabled model to use.

## Core Rules
- Delegate only bounded leaf work with stable context and a reviewable deliverable.
- Do not delegate final scope interpretation, acceptance, release decisions, integration ownership, or final validation.
- Parent agent must review subagent output, integrate deliberately, and validate before treating work as done.
- Do not use leaf implementation delegation to compensate for unclear requirements, unsafe orchestration, or missing validation strategy.
- For non-trivial work with a bounded subtask and cheap verification, delegate at least one useful scout, review, test-drafting, or implementation slice unless an avoid condition applies.

## Decision Tree
1. **Is there a bounded leaf task?**
   - trivial single action -> do it locally
   - broad/unclear work -> clarify, plan, narrow, or delegate only discovery/review
2. **Would delegation add real value?**
   - useful value: parallelism, coverage, fresh review, context isolation, specialization, cheaper routine execution, or stronger reasoning for a hard slice
   - no real value or review/integration cost exceeds benefit -> do it locally
3. **Is it safe to delegate?**
   - no if context cannot be packaged cleanly, agents would conflict heavily, or the subagent would own final decisions
4. **Choose the branch:**
   - active bounded Stardock execution plan -> put independent report, research, test, decision, implementation, or promotion jobs in the DAG and let `stardock_run` dispatch the complete ready set; do not launch overlapping raw subagents or legacy workers
   - routine bounded search/inspection/summary/test ideas -> downshift to cheaper or less scarce supported enabled model when safe
   - hard narrow correctness/reasoning/review slice -> upshift that slice to a stronger supported enabled model
   - independent review/context isolation -> same-model or same-class delegation is valid
   - broad risky work -> parent strengthens requirements/validation; subagents may scout or review only

## Model Selection
Agent files may define default models. Use the agent default when it fits the task; choose an explicit override only when capability, cost/quota/scarcity, latency, or context-window needs materially favor a different enabled model.

Before passing a model override, downshifting, or upshifting, call `list_pi_models` unless the current session already inspected it recently.

Selection rules:
- choose rows with `support: yes` and `enabled: yes` unless the user explicitly authorizes configuration changes
- `auth: yes` only means credentials exist; it is not enough for overrides
- models excluded or marked `support: no` are unavailable; use `unsupported: "include"` or `unsupported: "only"` only for diagnostics
- `spark` means premium very-low-latency, not cheap; use Spark only when speed is worth the cost
- if `list_pi_models` is unavailable, inspect current config such as `~/.pi/agent/settings.json`; if still uncertain, omit the override and state why the default is acceptable
- do not hard-code model ladders in prompts; provider support, cost, quota, speed, and quality change
- avoid scarce or credit-limited providers when an enabled Codex/default model is suitable; use provider-specific models only when their capability is worth the cost or the user asks for them
- when choosing among Codex models, prefer `openai-codex/gpt-5.4` as the normal default, `openai-codex/gpt-5.4-mini` for simple/cheap tasks, and reserve `openai-codex/gpt-5.5` for very important or high-stakes work

Choose by capability, cost/quota/scarcity, latency, context window, tool needs, and whether independence rather than model difference is the value.

## Agent Discovery
When using the `subagent` tool, inspect available agents with `subagent {"action":"list"}` if names or capabilities are uncertain. Example agent names are placeholders; replace them with configured agents from the current environment.

Prefer concrete repo-defined agents over generic builtins when guidance names a role:

| Need | Preferred path |
| --- | --- |
| Prompt/tool/skill behavior validation | `prompt-behavior-tester` |
| Bounded implementation outside Stardock | `implementer` |
| Bounded validation outside Stardock | `validator` |
| Plan quality review | `plan-reviewer` |
| Code-review triage | `review-triage` |
| Code-review targeted scout | `review-scout` |
| Code-review candidate verification | `review-verifier` |
| Impact-aware review | `impact-reviewer` |
| Generic code/plan/diff audit | `auditor` |
| Feynman research workflows | `feynman-researcher`, `feynman-verifier`, `feynman-reviewer`, `feynman-writer` |
| Bounded Stardock job DAG | `stardock_plan` defines arbitrary report, research, test, decision, implementation, or promotion jobs; `stardock_run` dispatches the complete ready set; governor decisions use `stardock_review`; integration is an explicit node or optional compatibility operation, not a required post-wave step |
| Planless legacy or recursive Stardock loop | Use its restored legacy surface, including `stardock_worker`, only for that compatibility workflow; do not mix it with a bounded execution DAG |

Use a generic builtin only as an explicit degraded fallback when the intended custom agent/tool is unavailable; record the degraded path. For research-heavy or source-sensitive work, prefer configured researcher/verifier/reviewer/writer-style agents when available; otherwise use a configured general-purpose agent with a bounded prompt.

## Workflow
1. Define the subtask, deliverable, acceptance criteria, allowed files/sources, and parent validation.
2. Discover agents/models when uncertain; do not copy placeholders or stale model names.
3. Choose a supported enabled model from `list_pi_models` when using a model override.
4. Use `TaskExecute` for task-tracked delegation when it fits; use `subagent` directly for one custom agent, or its workflow scripts for fan-out and multi-step work.
5. Keep prompts concrete and limited to context the subagent actually needs.
6. Review the result, integrate deliberately, and re-validate.

## Upstream Subagent Contract
- Configure `excludeTools` in agent definitions using exact registered tool names. Do not send `denyTools` or `clarify`, or invent execution-level exclusion fields.
- Use `subagent({ agent, task })` for one child. For parallel or sequential work, use the same `subagent` tool with `workflow`; do not send legacy `tasks`, `chain`, or template variables. There is no separate `subagent_workflow` tool.
- Put context and other non-top-level execution fields inside `options`, for example `{ agent: "review-scout", task: "Inspect auth", async: false, options: { context: "fresh" } }`. Discover exact current fields with `{ action: "guide", options: { topic: "tool-reference" } }`.
- Selected skills provide names, descriptions, and paths. Children read their skill files when needed; a catalog entry is not an already-loaded instruction body.
- Grant non-builtin tools through explicit `extensions` or agent `subagentOnlyExtensions`. Use `mcp:<server>/<tool>` in agent tool lists for native MCP grants; do not assume the parent's ambient extensions are available in foreground children.
- Repo code roles explicitly inherit project and global instructions. Other agents retain their upstream context defaults; request fresh/forked context deliberately.
- Keep leaf roles non-delegating. Authorize child fanout only with `tools: subagent` or `allowNestedSubagents: true`, within the configured depth and capability limits; selecting `pi-subagents` as a child skill is not authorization.

### Workflow Recipes
Write a script file such as `.pi/workflows/review.js`, then call `subagent({ workflow: "./.pi/workflows/review.js", async: false, options: { context: "fresh" } })`. All children share the workflow's `cwd`; use explicit dedicated artifact paths when files are needed. Agent names below must exist in current discovery.

Parallel script body:
```js
return await runs.all([
  { key: "auth", agent: "review-scout", task: "Inspect auth without editing." },
  { key: "tests", agent: "review-verifier", task: "Inspect tests without editing." }
]);
```

Sequential handoff script body:
```js
const scan = await runs.run("scan", { agent: "review-scout", task: "Inspect auth without editing." });
return await runs.run("review", { agent: "review-verifier", task: "Verify these candidates without editing:\n" + scan.output });
```

`runs.all` returns an ordered array, not a key map. Await child results before reading `.output`; pass results explicitly instead of legacy shared-directory templates. The parent still owns acceptance and validation.

## Delegation Template
```md
Task: <bounded task>
Context: <only relevant context>
Deliverable: <what the subagent should return>
Model: <supported enabled model, with cost/latency/quota/capability reason>
Constraints: <important rules>
Validation: <how the parent will check the result>
```

## Common Failure Modes
- “I can just do it myself.” For non-trivial bounded work, delegate/downshift one useful leaf unless an avoid condition applies. In a bounded Stardock plan, this means defining the appropriate job leaf and calling `stardock_run`; a scout, raw subagent, governor edit, or legacy `stardock_worker` does not replace the plan-owned lane. Treat multi-file or new-file work as non-trivial, not trivial/surgical.
- “The strongest model is safest.” Do not spend scarce top-model quota on mechanical, easy-to-verify work.
- “It is enabled/authenticated, so it is usable.” Require catalog `support: yes` and `enabled: yes`.
- “Spark is cheap because it is fast.” Spark is premium latency.
- “The subagent can figure out scope.” Delegated work needs explicit files, sources, deliverables, and acceptance criteria.
- “The subagent result is enough.” Parent validation is mandatory.

## Editing This Skill
When changing this skill, test the scenarios in `validation-scenarios.md`.
