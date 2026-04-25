---
name: verification-before-completion
description: Use when about to claim work is done, fixed, passing, ready, or before committing, pushing, opening PRs, or marking tasks complete.
---

# Verification Before Completion

Evidence comes before completion claims. Do not say work is done, fixed, passing, or ready unless fresh verification supports that claim or you clearly disclose the gap.

## When to Use
Use before:
- reporting success or completion
- committing, pushing, opening a PR, or marking a task complete
- summarizing or integrating subagent work
- relying on validation that was partial, skipped, unavailable, or run earlier

## Verification Gate
Before a success/completion claim:
1. Identify the evidence needed for the claim: tests, build, lint, typecheck, manual/browser check, benchmark, diff inspection, or requirements checklist.
2. Run or inspect the strongest fresh evidence available for the risk.
3. Read the output: exit code, failures, warnings, skipped tests, and changed files.
4. Inspect final diff or changed-file set when files were edited, even if tests pass.
5. Compare evidence to the actual requirement, not just to "tests pass".
6. Report accurately: what passed, what failed, what was skipped/unavailable, and remaining risk.

## Evidence by Claim
| Claim | Required evidence |
| --- | --- |
| Tests/build/typecheck pass | fresh command output and exit code |
| Bug fixed | original symptom reproduced or covered, then verified fixed |
| Regression test works | old behavior fails or equivalent evidence exists, then new behavior passes |
| Requirements met | checklist against user request, plan, and invariants |
| Subagent completed work | parent inspected output/diff and selected or ran relevant validation |
| Ready to commit | relevant validation plus staged diff review |

## Red Flags
Stop and verify before saying: "should work", "probably", "looks good", "done", "the agent said it passed", "only a small change", or "I'll skip validation just this once".

## Practical Guidance
- Match validation depth to risk: typo -> diff inspection may suffice; parser or contract change -> focused tests plus broader checks.
- Prefer project-sanctioned commands from README, scripts, CI, or local docs.
- Do not claim broad success from narrow checks; say "typecheck passed; tests not run" when true.
- If validation is impossible because credentials, services, time, or tooling are unavailable, disclose the blocker and do not overstate confidence.

## Report Shape
```md
Validation:
- Ran: `<command>` -> <result>
- Inspected: <diff/files/output> -> <result>
- Not run / unavailable: <reason>
- Remaining risk: <if any>
```

## Attribution
Adapted from the verification-before-completion guidance in `pcvelz/superpowers` (MIT), reduced for Pi's evidence-reporting workflow.
