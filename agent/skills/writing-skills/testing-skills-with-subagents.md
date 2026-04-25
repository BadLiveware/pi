# Testing Skills With Subagents

Use this reference when creating or editing skills that must change future agent behavior.

## Principle
Testing skills is TDD for instructions. If you did not observe the old guidance fail, you do not know whether the new guidance fixes the right failure.

## RED-GREEN-REFACTOR

| Phase | Skill test action | Evidence to capture |
| --- | --- | --- |
| RED | Run a baseline scenario without the new guidance | exact failure, shortcut, or rationalization |
| GREEN | Add the smallest targeted instruction | diff and intended behavior change |
| Verify GREEN | Run the same scenario with the skill available | compliance and cited guidance |
| REFACTOR | Add counters for new loopholes | updated rule and re-test result |

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

## Running Tests in Pi
Use a fresh subagent for behavioral tests so the current conversation does not contaminate the result.

Baseline options:
- Ask the subagent not to read the skill under test and provide only the old/current guidance excerpt.
- For stronger isolation, run an external `pi -p` process with a temporary `PI_CODING_AGENT_DIR` and discovery disabled.
- If the changed skill is already globally loaded and cannot be isolated, record that as the RED-phase limitation and run a regression pressure test with the changed skill.

Verification options:
- Ask the subagent to read the changed skill file first.
- For stronger isolation, run external `pi -p` with discovery disabled and load only the skill under test via `--skill`.
- Use the same scenario as the baseline.
- Require a concrete choice/action and a short rationale.

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
- `--no-tools` is appropriate for choice/output pressure tests. Omit it or pass `--tools ...` only when the skill behavior requires tool use.
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
- model/agent used,
- prompt/scenario,
- whether the skill was available,
- choice/action taken,
- exact rationalizations or cited rules,
- follow-up changes made.

## What to Fix After a Failed Verification
When an agent still violates the intended behavior, capture the reason verbatim and add a targeted counter.

Common counters:
- explicit “no exceptions” list,
- rationalization table mapping excuse to reality,
- red flags that force a stop/restart,
- earlier placement of the core principle,
- clearer trigger terms in the description,
- a concrete “do this instead” action.

Do not add broad vague warnings like “be careful”. Add the specific sentence that would have blocked the observed failure.

## Completion Checklist
- [ ] Baseline behavior or reason for skipping baseline is recorded.
- [ ] Skill change targets an observed failure or explicit requirement.
- [ ] Verification scenario ran with the changed skill, or gap is documented.
- [ ] New rationalizations were plugged and re-tested when found.
- [ ] Frontmatter remains valid and description is trigger-only.
- [ ] `./link-into-pi-agent.sh` ran for global skill changes.

## Attribution
Adapted from pcvelz/superpowers skill-testing guidance (MIT).
