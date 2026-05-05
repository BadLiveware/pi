---
name: systematic-debugging
description: Use when encountering a bug, failing test, build failure, performance regression, or unexpected behavior before proposing fixes.
---

# Systematic Debugging

Find the root cause before fixing symptoms. Do not stack speculative fixes when you can gather evidence first.

## When to Use
Use when tests/builds fail, behavior differs from expectations, the cause is not proven, prior fixes failed, or multiple components/configs/environments could be involved.

## Outcome
- reproduced or clearly observed failure
- falsifiable root-cause hypothesis backed by evidence
- smallest fix for the cause, not symptoms
- validation covering the original symptom and relevant regressions

## Workflow
1. Read the full error, stack trace, logs, or failing assertion. Do not skim line numbers or warnings.
2. Reproduce the failure or record why it cannot be reproduced. Capture command, input, environment, and observed output.
3. Check recent changes: local diff, commits, dependencies/config, environment, generated artifacts.
4. Trace the failing value/state backward to where it is introduced. Inspect or add diagnostics at component boundaries before guessing.
5. Compare with a working reference in the codebase or upstream docs.
6. State one falsifiable hypothesis: "I think X is the cause because Y."
7. Test the hypothesis with the smallest useful experiment; change one variable at a time.
8. Implement the smallest fix for the proven cause; avoid unrelated cleanup unless it directly reduces debugging risk.
9. Add or update focused validation for the original symptom and any invariant the fix relies on.
10. If the fix fails, reassess with new evidence instead of piling on changes.

## Runtime Tracing Escalation

Use `bpftrace` or similar runtime tracing only when the failure is reproducible but normal logs/tests do not reveal the system boundary involved: syscalls, files, sockets, subprocesses, scheduler behavior, or resource growth. Keep probes scoped to the suspected process or child tree, read-only, and time-bounded; record the script plus observed evidence. Do not require bpftrace for ordinary debugging, and do not treat one traced run as exhaustive correctness proof.

## Stop Conditions
- If you cannot reproduce or observe the failure, gather more evidence before changing production code.
- Do not hide symptoms by deleting/skipping tests, loosening assertions, suppressing errors, broadening catches, filtering logs, or increasing timeouts before proving expected behavior changed.
- If three plausible fixes fail, stop and question the diagnosis or architecture.
- If desired behavior is unclear, use `requirements-discovery` before fixing.
- If the fix affects failure handling, optional state, compatibility, or user-facing errors, use `reliability-error-handling`.

## Evidence Shape
```md
Failure: <command/input, observed, expected>
Evidence: <recent changes, working reference, boundary/state observations>
Hypothesis: I think ... because ...
Fix: <root cause addressed, files changed>
Validation: <focused check, regression/invariant check, gaps>
```

## Attribution
Adapted from the systematic-debugging guidance in `pcvelz/superpowers` (MIT), reduced for Pi's lighter, scope-aware workflow.
