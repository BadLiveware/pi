---
name: verification-before-completion
description: Use when about to claim work is done, fixed, passing, ready, or before committing, pushing, opening PRs, or marking tasks complete.
---

# Verification Before Completion

Evidence comes before completion claims. Do not say work is done, fixed, passing, or ready unless fresh verification supports that claim or you clearly disclose the gap.

## Reach for This Skill When
- about to report success or completion
- about to commit, push, open a PR, or mark a task completed
- a subagent reports success and you need to integrate or summarize it
- validation was partial, skipped, unavailable, or run earlier in the session

## Outcome
- exact verification commands or inspections tied to the claim
- fresh output or evidence checked before the claim
- honest disclosure of failures, skipped checks, unavailable credentials, or remaining risk

## Verification Gate
Before any success/completion claim:

1. **Identify** what would prove the claim: test, build, lint, typecheck, manual check, diff inspection, browser check, benchmark, or requirement checklist.
2. **Run or inspect** the strongest relevant fresh evidence available for the risk.
3. **Read the output** and check exit codes, failure counts, warnings, and changed files.
4. **Inspect the final diff or changed-file set** when files were edited, even if tests pass, so unintended edits, generated artifacts, and unrelated changes are caught before completion claims.
5. **Compare** evidence to the actual requirement, not just to "tests pass".
6. **Report accurately:**
   - if it passed, cite what ran or what was inspected;
   - if it failed, state the failure and next needed action;
   - if it was skipped or unavailable, say why and what remains unverified.

## Claims and Required Evidence

| Claim | Evidence needed |
| --- | --- |
| Tests pass | fresh test command output for the relevant suite |
| Build/typecheck passes | fresh build/typecheck output and exit code |
| Bug fixed | original symptom reproduced or covered, then verified fixed |
| Regression test works | test fails for the old behavior or equivalent evidence, then passes with the fix |
| Requirements met | checklist against requirements, plan, or user request |
| Subagent completed work | parent inspected output/diff and ran or selected relevant validation |
| Ready to commit | relevant validation plus staged diff review |

## Red Flags
Stop and verify before writing success language if you catch yourself saying:
- "should work"
- "probably"
- "looks good"
- "done" without evidence
- "the agent said it passed"
- "only a small change"
- "I'll skip validation just this once"

## Practical Guidance
- Match validation depth to risk. A typo may need diff inspection; parser changes likely need focused tests plus broader checks.
- Prefer project-sanctioned commands. If unknown, inspect README, package scripts, CI, or existing docs.
- Do not claim broad success from narrow checks. Say "typecheck passed; tests not run" when that is true.
- For delegated work, verify independently before integrating or marking tasks complete.
- If validation is impossible because of missing credentials, services, time, or tooling, disclose the blocker and do not overstate confidence.

## Report Template

```md
Validation:
- Ran: `<command>` -> <result>
- Inspected: <diff/files/output> -> <result>
- Not run / unavailable: <reason>
- Remaining risk: <if any>
```

## Attribution
Adapted from the verification-before-completion guidance in `pcvelz/superpowers` (MIT), reduced for Pi's evidence-reporting workflow.
