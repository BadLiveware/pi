---
name: systematic-debugging
description: Use when encountering a bug, failing test, build failure, performance regression, or unexpected behavior before proposing fixes.
---

# Systematic Debugging

Find the root cause before fixing symptoms. Do not stack speculative fixes when you can gather evidence first.

## Reach for This Skill When
- tests, builds, or integration checks fail
- behavior differs from expectations
- a quick fix seems obvious but the cause is not proven
- prior fixes did not work
- multiple components, configs, or environments could be involved

## Outcome
- a reproduced or clearly observed failure
- a concrete root-cause hypothesis backed by evidence
- the smallest fix that addresses the cause
- validation that the original symptom and relevant regressions are covered

## Workflow
1. Read the full error, stack trace, logs, or failing assertion. Do not skim past line numbers or warnings.
2. Reproduce the failure or record why it cannot be reproduced. Capture the exact command, input, environment, and observed output.
3. Check recent changes: local diff, relevant commits, dependency/config changes, environment differences, and generated artifacts.
4. Trace the failing value or state backward to where it is introduced. In multi-component flows, add or inspect diagnostics at boundaries before guessing.
5. Find a working reference in the same codebase or upstream docs and compare it to the broken path.
6. State one hypothesis: "I think X is the cause because Y." Keep it falsifiable.
7. Test the hypothesis with the smallest useful experiment. Change one variable at a time.
8. Implement the smallest fix for the proven cause. Avoid unrelated cleanup unless it directly reduces debugging risk.
9. Add or update focused validation for the original symptom and any invariant the fix relies on.
10. If the fix fails, do not pile on changes. Reassess with the new evidence and form a new hypothesis.

## Stop Conditions
- If you cannot reproduce or observe the failure, gather more evidence before changing production code.
- Do not hide symptoms by deleting/skipping tests, loosening assertions, suppressing errors, broadening catches, filtering logs, or increasing timeouts before proving the expected behavior or timing contract changed.
- If three plausible fixes fail, stop and question the diagnosis or architecture before trying another patch.
- If the issue depends on unclear requirements or desired behavior, use `requirements-discovery` before fixing.
- If the fix affects failure handling, optional state, compatibility, or user-facing errors, use `reliability-error-handling`.

## Evidence Template

```md
## Failure
- Command/input:
- Observed output:
- Expected output:

## Evidence
- Recent changes:
- Working reference:
- Boundary/state observations:

## Hypothesis
I think ... because ...

## Fix
- Root cause addressed:
- Files changed:

## Validation
- Focused check:
- Regression/invariant check:
- Remaining gaps:
```

## Attribution
Adapted from the systematic-debugging guidance in `pcvelz/superpowers` (MIT), reduced for Pi's lighter, scope-aware workflow.
