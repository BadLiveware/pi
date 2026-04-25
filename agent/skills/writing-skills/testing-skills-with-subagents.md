# Testing Skills With Subagents

Use this reference when creating or editing skills that must change future agent behavior.

## Principle
Testing skills is TDD for instructions. If you did not observe the old guidance fail, you do not know whether the new guidance fixes the right failure.

## RED-GREEN-REFACTOR-ITERATE

| Phase | Skill test action | Evidence to capture |
| --- | --- | --- |
| RED | Run a baseline scenario without the new guidance | exact failure, shortcut, or rationalization |
| GREEN | Add the smallest targeted instruction | diff and intended behavior change |
| Verify GREEN | Run the same scenario with the skill available | compliance and cited guidance |
| REFACTOR | Add counters for new loopholes | updated rule and re-test result |
| ITERATE | If verification still fails, edit the skill again and re-run the failed scenario | each targeted counter and the result that proves it worked |

Default loop: test, inspect the failure, edit the skill, and re-test. Keep looping while the failure can be fixed by clarifying, tightening, adding examples, adding anti-rationalizations, or moving existing guidance earlier without changing what the skill is meant to do.

Stop and ask instead of editing when the next fix would materially change the skill's semantics: changing its purpose, supported workflow, authority boundaries, safety policy, model/tool assumptions, or tradeoffs in a way the user did not already approve.

## Scenario Design
Good tests make the agent want to do the wrong thing.

Use pressure scenarios for discipline skills:
- time pressure: deadline, deploy window, user impatience
- sunk cost: work already done that should be discarded or redone
- authority pressure: senior/user says to skip the rule
- economic/social pressure: visible cost, embarrassment, “pragmatism”
- exhaustion: end-of-day, long session, context fatigue

A strong scenario has:
1. a concrete project or file path,
2. specific consequences,
3. 3+ combined pressures for discipline rules,
4. explicit options or an action the agent must take,
5. no easy escape like “ask the user” unless asking is the desired rule.

Template:
```markdown
IMPORTANT: Treat this as a real task. Choose and act.

Context: <repo/path and current state>
Pressure: <deadline/sunk cost/authority/etc.>
Rule at risk: <what the skill should enforce>
Options:
A) <correct but costly behavior>
B) <tempting shortcut>
C) <hybrid rationalization>

Choose A, B, or C and explain briefly.
```

## Realism Ladder
Use the cheapest test that exercises the behavior under realistic pressure:

1. **Choice pressure test:** scenario with tempting options. Good for quick branch-regression checks, but easier than real work because the right action is visible.
2. **Micro-action test:** tiny disposable fixture plus a small tool/action budget. The agent must inspect evidence or take 1-3 realistic actions, then stop at the skill's key decision point. Prefer this after significant behavior changes, pruning, or splitting.
3. **Mini end-to-end test:** disposable repo or fixture where the agent performs a tiny realistic workflow, such as reproduce -> fix -> validate. Use sparingly for high-risk skills because it costs more.

Micro-action tests are the default realism upgrade. They should be bounded: create a `/tmp/skill-test-*` fixture, allow only the tools needed, set a tool/action budget, and ask the agent to stop once the target decision is reached instead of completing a large task.

Examples:
- `commit`: provide fake status/diff/validation files; ask what to stage/commit and what to leave untouched.
- `verification-before-completion`: provide subagent report, test output, and diff; ask whether completion can be claimed from the evidence.
- `requirements-discovery`: provide a tiny README/config plus an ambiguous request; ask for the next question or safe assumption.
- `systematic-debugging`: provide a tiny failing test; ask the agent to reproduce, state a hypothesis, and stop or make one evidence-backed fix within a budget.
- `execute-plan`: provide a three-item plan; ask the agent to create only the next small task window and decide whether to continue or summarize.

## Running Tests in Pi
Use a fresh subagent or external `pi -p` process for behavioral tests so the current conversation does not contaminate the result.

### Model Coverage
For behavior-affecting skill changes, run verification on both:

1. the normal/default model used for ordinary work, and
2. the cheapest or smallest supported enabled model that might realistically execute the skill.

Call `list_pi_models` before choosing the lower-cost model. Use only rows with `support: yes` and `enabled: yes` unless the user explicitly authorizes configuration changes. If no cheap/mini model is currently supported and enabled, record that gap. Do not use a `-spark` model as the cheap/mini test substitute; Spark models are premium very-low-latency options and should be tested only when latency-specific behavior matters.

For reference-only or non-behavioral edits, one model or structural validation may be enough if you record why broader model coverage is not relevant. For discipline, safety, planning, commit, delegation, or verification skills, default to both model classes unless cost, quota, or availability blocks it.

Do not over-optimize away adherence testing to save a small amount of model spend. These tests are usually inexpensive, while a broken skill can repeatedly produce bad future behavior. If cost or quota prevents the preferred coverage, record the skipped model tier and why it was skipped instead of silently reducing validation.

Baseline options:
- Ask the subagent not to read the skill under test and provide only the old/current guidance excerpt.
- For stronger isolation, run an external `pi -p` process with a temporary `PI_CODING_AGENT_DIR` and discovery disabled.
- If the changed skill is already globally loaded and cannot be isolated, record that as the RED-phase limitation and run a regression pressure test with the changed skill.

Verification options:
- Ask the subagent to read the changed skill file first.
- For stronger isolation, run external `pi -p` with discovery disabled and load only the skill under test via `--skill`.
- Use the same scenario or fixture as the baseline.
- Require a concrete choice/action and a short rationale.
- For micro-action tests, include fixture path, allowed tools/actions, budget, and stop condition.

### Hermetic External Pi Runs
Use this when you need a cleaner RED/GREEN test than an in-session subagent can provide.

```bash
SANDBOX="$(mktemp -d)"
export PI_CODING_AGENT_DIR="$SANDBOX/agent"
mkdir -p "$PI_CODING_AGENT_DIR"

# Optional: if the isolated agent dir has no model credentials, either pass
# --provider/--model/--api-key explicitly or copy only the minimum local Pi auth
# files needed for model access. Keep discovery disabled below.
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
  "$(cat /tmp/skill-pressure-scenario.txt)" \
  2>&1 | tee /tmp/skill-red.txt

# GREEN: same isolation, but explicitly load only the skill being tested.
pi -p \
  --no-session \
  --no-tools \
  --no-skills \
  --skill /home/fl/code/personal/pi/agent/skills/<skill>/SKILL.md \
  --no-extensions \
  --no-prompt-templates \
  --no-themes \
  --no-context-files \
  "$(cat /tmp/skill-pressure-scenario.txt)" \
  2>&1 | tee /tmp/skill-green.txt
```

Notes:
- `PI_CODING_AGENT_DIR` isolates Pi's agent config and session lookup from `~/.pi/agent`.
- A blank isolated agent dir may not have credentials. Prefer explicit `--provider`, `--model`, and `--api-key` for reproducible tests; copying `auth.json`, `models.json`, and `settings.json` is a pragmatic local fallback.
- If you copy settings/auth files, record that in the test evidence. The discovery-disabling flags still prevent skills/extensions/context files from loading, but settings can affect default provider/model choice.
- `--no-tools` is appropriate for choice/output pressure tests. For micro-action tests, pass only the needed tools, such as `--tools read,ls,bash`, and state the action budget in the prompt.
- `--no-skills` disables discovery; explicit `--skill` paths still load.
- `--no-context-files` prevents local `AGENTS.md` / `CLAUDE.md` from adding unrelated guidance.
- Use a temporary working directory when local project files could influence the answer.

Example Pi subagent call:
```json
{
  "agent": "worker",
  "context": "fresh",
  "task": "Read /home/fl/code/personal/pi/agent/skills/<skill>/SKILL.md. Then handle this scenario as real work, not academically. <scenario>"
}
```

Example verification prompt:
```markdown
Read `/home/fl/code/personal/pi/agent/skills/<skill>/SKILL.md`.
Then handle this scenario as real work. Do not answer academically.

<scenario>
```

Record:
- model/agent used for each verification tier, or why a tier was unavailable,
- test tier used: choice, micro-action, or mini end-to-end,
- prompt/scenario and fixture path when applicable,
- whether the skill was available,
- observed failure or behavior,
- inferred cause or loophole,
- wording fix or reason no fix was needed,
- choice/action taken,
- exact rationalizations or cited rules,
- follow-up changes made.

## Testing After Pruning or Splitting
When reducing token cost, test the behavior the main file must still preserve. Good splits keep normal-use decisions in `SKILL.md` and move rare material such as examples, validation scenarios, long checklists, and background rationale into reference files.

Do not assume a smaller skill still works because the removed text was "only examples." Run pressure scenarios for the core branches and failure modes. If the agent now skips a required tool, misses a safety boundary, or over/under-applies the skill, move the missing decision-critical rule back into `SKILL.md` or add a concise inline counter.

Avoid splitting into many tiny files. Extra files can cost more tool trips, increase latency, and create retrieval failures. Cached tokens may reduce repeated-read cost, but they do not remove first-use cost or attention/context cost.

Record before/after approximate tokens when token cost was a goal, plus the behavior scenarios that still passed.

## What to Fix After a Failed Verification
When an agent still violates the intended behavior, separate observation, inference, and fix: record what the agent did, why you think the guidance allowed it, and the smallest wording change that should block it. Then add the targeted counter and re-run the failed scenario. Do not merely report the failure when the intended behavior is clear and the fix preserves the skill's semantics.

Common counters:
- explicit “no exceptions” list,
- rationalization table mapping excuse to reality,
- red flags that force a stop/restart,
- earlier placement of the core principle,
- clearer trigger terms in the description,
- a concrete “do this instead” action.

Do not add broad vague warnings like “be careful”. Add the specific sentence that would have blocked the observed failure. After the edit, re-test the same pressure scenario before moving on.

Examples of semantics-preserving fixes:
- make an existing trigger more explicit,
- add a counter for an observed rationalization,
- add a positive or negative example,
- move a critical rule earlier,
- clarify when to stop, ask, or avoid the skill.

Examples that likely change semantics and require confirmation:
- expanding the skill to a new domain or authority level,
- changing a must/never rule into a preference or vice versa,
- changing who owns safety, acceptance, or final decisions,
- adding a new required tool/provider/model assumption,
- changing the intended tradeoff between speed, cost, quality, or risk.

## Completion Checklist
- [ ] Baseline behavior or reason for skipping baseline is recorded.
- [ ] Skill change targets an observed failure or explicit requirement.
- [ ] Verification scenario ran with the changed skill, or gap is documented.
- [ ] Significant behavior changes, pruning, or splitting used a micro-action test where practical, or the reason a choice test was sufficient is documented.
- [ ] Behavior-affecting changes were checked on normal/default and cheap/small supported enabled models, or the missing tier was documented.
- [ ] Failed verification led to a targeted edit and same-scenario re-test, unless the needed fix would materially change semantics.
- [ ] New rationalizations were plugged and re-tested when found.
- [ ] Frontmatter remains valid and description is trigger-only.
- [ ] If the change pruned or split a skill, before/after token counts and core-branch behavior results are recorded.
- [ ] `./link-into-pi-agent.sh` ran for global skill changes.

## Attribution
Adapted from pcvelz/superpowers skill-testing guidance (MIT).
