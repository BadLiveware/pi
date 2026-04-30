# Testing Agent Guidance With Subagents

Use this reference when prompt, skill, tool, command, payload, or policy text must change future agent behavior.

## Principle

Behavior testing is TDD for instructions. If you did not observe the old or current guidance fail, you may not know whether the new wording fixes the right failure.

## RED-GREEN-REFACTOR-ITERATE

| Phase | Test action | Evidence to capture |
| --- | --- | --- |
| RED | Run a baseline scenario without the new guidance when practical | exact failure, shortcut, over-trigger, under-trigger, or rationalization |
| GREEN | Add the smallest targeted instruction | diff and intended behavior change |
| Verify GREEN | Run the same scenario with the changed guidance available | compliance, trigger choice, parameter shape, and cited reasoning |
| REFACTOR | Add counters for new loopholes | updated rule and re-test result |
| ITERATE | If verification still fails, edit again and re-run the failed scenario | each targeted counter and the result that proves it worked |

Keep looping while the failure can be fixed by clarifying, tightening, adding examples, adding anti-rationalizations, or moving existing guidance earlier without changing what the guidance is meant to do.

Stop and ask when the next fix would materially change purpose, supported workflow, authority boundaries, safety policy, model/tool assumptions, or speed/cost/quality tradeoffs.

## Scenario Design

Use natural language. Do not leak the exact framework terms, file names, option labels, tool names, or section headings that the guidance is supposed to infer unless recognition of those exact terms is the behavior under test.

For trigger or scope changes, include paired scenarios:
- near-positive: natural wording that should trigger the guidance
- near-negative: similar wording that should not trigger it, should defer to another skill/tool, or should use only a lightweight/internal version

Passing means the agent gets both sides of the boundary right without being cued by exact names.

Pressure scenarios are useful for discipline or safety guidance:
- time pressure
- sunk cost
- authority pressure
- cost/quota pressure
- social pressure
- exhaustion
- tempting hybrid rationalization

Template:

```markdown
IMPORTANT: Treat this as a real task. Choose and act.

Context: <repo/path and current state>
Pressure: <deadline/sunk cost/authority/etc.>
Rule at risk: <what the guidance should enforce>
Options:
A) <correct but costly behavior>
B) <tempting shortcut>
C) <hybrid rationalization>

Choose A, B, or C and explain briefly.
```

## Realism Ladder

Use the cheapest test that exercises the behavior under realistic pressure:

1. **Choice pressure test:** scenario with tempting options. Good for quick branch-regression checks, but easier than real work because the right action is visible.
2. **Micro-action test:** tiny disposable fixture plus a small tool/action budget. The agent must inspect evidence or take 1-3 realistic actions, then stop at the key decision point.
3. **Mini end-to-end test:** disposable repo or fixture where the agent performs a tiny realistic workflow. Use sparingly for high-risk guidance.

Micro-action tests are the default realism upgrade. They should be bounded: create a `/tmp/guidance-test-*` fixture, allow only needed tools, set a tool/action budget, and ask the agent to stop once the target decision is reached.

Examples:
- tool description: provide a natural request and ask which tool and parameters to call
- command help: ask how to perform a config change and verify whether the agent chooses the command or structured tool appropriately
- prompt builder: provide a simulated worker prompt and judge whether the response satisfies the output contract
- policy text: ask whether completion is ready under pressure and verify that advisory findings are not treated as hidden hard gates
- skill trigger: ask a near-positive and near-negative scenario and verify the skill boundary

## Running Tests in Pi

Use a fresh subagent or external `pi -p` process for behavioral tests so the current conversation does not contaminate the result.

### Model Coverage

For behavior-affecting changes, run verification on both:

1. the normal/default model used for ordinary work, and
2. the cheapest or smallest supported enabled model that might realistically execute the guidance.

Call `list_pi_models` before choosing the lower-cost model. Use only rows with support and enabled status unless the user explicitly authorizes configuration changes. If no cheap/mini model is supported and enabled, record that gap. Do not use a `-spark` model as the cheap/mini substitute; Spark models are premium low-latency options and should be tested only when latency-specific behavior matters.

For reference-only or non-behavioral edits, one model or structural validation may be enough if you record why broader model coverage is not relevant.

### Subagent Options

Baseline options:
- Ask the subagent not to read the changed guidance and provide only the old/current excerpt.
- For stronger isolation, run an external `pi -p` process with a temporary `PI_CODING_AGENT_DIR` and discovery disabled.
- If changed guidance is already globally loaded and cannot be isolated, record that RED-phase limitation and run a regression pressure test with the changed guidance.

Verification options:
- Ask the subagent to read the changed file first.
- For stronger isolation, run external `pi -p` with discovery disabled and load only the guidance under test when possible.
- Use the same scenario or paired positive/negative scenarios as the baseline.
- Require a concrete choice/action and short rationale.
- For micro-action tests, include fixture path, allowed tools/actions, budget, and stop condition.

Example subagent call:

```json
{
  "agent": "worker",
  "context": "fresh",
  "task": "Read /home/fl/code/personal/pi/agent/skills/prompt-behavior-testing/SKILL.md. Then handle this scenario as real work, not academically. <scenario>"
}
```

## Hermetic External Pi Runs

Use this when you need a cleaner RED/GREEN test than an in-session subagent can provide.

```bash
SANDBOX="$(mktemp -d)"
export PI_CODING_AGENT_DIR="$SANDBOX/agent"
mkdir -p "$PI_CODING_AGENT_DIR"

# Optional local fallback if the isolated agent dir has no model credentials.
cp ~/.pi/agent/auth.json "$PI_CODING_AGENT_DIR/auth.json" 2>/dev/null || true
cp ~/.pi/agent/models.json "$PI_CODING_AGENT_DIR/models.json" 2>/dev/null || true
cp ~/.pi/agent/settings.json "$PI_CODING_AGENT_DIR/settings.json" 2>/dev/null || true

# RED: no discovered skills, extensions, prompt templates, themes, or context files.
pi -p \
  --no-session \
  --no-tools \
  --no-skills \
  --no-extensions \
  --no-prompt-templates \
  --no-themes \
  --no-context-files \
  "$(cat /tmp/guidance-pressure-scenario.txt)" \
  2>&1 | tee /tmp/guidance-red.txt

# GREEN: same isolation, but explicitly load only the guidance being tested when possible.
pi -p \
  --no-session \
  --no-tools \
  --no-skills \
  --skill /home/fl/code/personal/pi/agent/skills/prompt-behavior-testing/SKILL.md \
  --no-extensions \
  --no-prompt-templates \
  --no-themes \
  --no-context-files \
  "$(cat /tmp/guidance-pressure-scenario.txt)" \
  2>&1 | tee /tmp/guidance-green.txt
```

Notes:
- `PI_CODING_AGENT_DIR` isolates Pi agent config and session lookup from `~/.pi/agent`.
- A blank isolated agent dir may not have credentials. Prefer explicit provider/model settings for reproducible tests; copying auth/settings is a pragmatic local fallback.
- Discovery-disabling flags prevent unrelated skills/extensions/context from loading.
- `--no-tools` is appropriate for choice tests. For micro-action tests, pass only needed tools and state the action budget.
- `--no-skills` disables discovery; explicit `--skill` paths still load.
- `--no-context-files` prevents local `AGENTS.md` or `CLAUDE.md` from adding unrelated guidance.

## Record Format

Record:
- model/agent used for each verification tier, or why a tier was unavailable
- test tier used: choice, micro-action, or mini end-to-end
- prompt/scenario and fixture path when applicable
- whether the changed guidance was available
- observed failure or behavior
- inferred cause or loophole
- wording fix or reason no fix was needed
- choice/action taken
- exact rationalizations or cited rules
- follow-up changes made

## Completion Checklist

- [ ] Baseline behavior or reason for skipping baseline is recorded.
- [ ] Change targets an observed failure or explicit requirement.
- [ ] Verification scenario ran with changed guidance, or gap is documented.
- [ ] Significant behavior changes, pruning, or splitting used a micro-action test where practical, or the reason a choice test was sufficient is documented.
- [ ] Behavior-affecting changes were checked on normal/default and cheap/small supported enabled models, or the missing tier was documented.
- [ ] Failed verification led to a targeted edit and same-scenario re-test, unless the needed fix would materially change semantics.
- [ ] New rationalizations were plugged and re-tested when found.
- [ ] Trigger descriptions remain trigger-only.
- [ ] If a skill was pruned or split, before/after approximate tokens and core-branch behavior results are recorded.
- [ ] `./link-into-pi-agent.sh` ran for global agent changes.

## Attribution

Adapted from `pcvelz/superpowers` skill-testing guidance (MIT).
