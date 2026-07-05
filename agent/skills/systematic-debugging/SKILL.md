---
name: systematic-debugging
description: >-
  Use when a reproducible failure or unclear bug needs root-cause investigation before fixing:
  failing test/build command, runtime error, regression, or unexpected behavior. Do not use for
  advisory diagnostics or routine validation triage after an authoritative check passes.
---

# Systematic Debugging

Find the root cause before fixing symptoms. Do not stack speculative fixes when you can gather evidence first.

## When to Use
Use when tests/builds fail, behavior differs from expectations, the cause is not proven, prior fixes failed, or multiple components/configs/environments could be involved.

## Nearby Non-Triggers
Do not use this skill just because a tool surfaced advisory diagnostics, stale-looking LSP output, or touched-file warnings when an authoritative project check already passed. Treat that as validation triage: inspect freshness/provenance, rerun or cite the authoritative check when needed, and use `verification-before-completion` before claiming readiness. Escalate to systematic debugging only if you reproduce a real failure, the authoritative check fails, or the discrepancy itself blocks the task.

## Outcome
- reproduced or clearly observed failure
- failing focused test or equivalent executable proof of the bug when practical
- falsifiable root-cause hypothesis backed by evidence
- a fix that addresses the real owning cause, not just the easiest local symptom patch
- validation covering the original symptom and relevant regressions

## Workflow
1. Read the full error, stack trace, logs, or failing assertion. Do not skim line numbers or warnings.
2. Reproduce the failure or record why it cannot be reproduced. Capture command, input, environment, and observed output.
3. Before changing production code, capture the bug with the smallest focused failing test or equivalent executable check when practical. If that is genuinely impractical, record why and what substitute evidence will stand in for RED.
4. Check recent changes: local diff, commits, dependencies/config, environment, generated artifacts.
5. Trace the failing value/state backward to where it is introduced. Inspect or add diagnostics at component boundaries before guessing.
6. Compare with a working reference in the codebase or upstream docs.
7. State one falsifiable hypothesis: "I think X is the cause because Y."
8. Test the hypothesis with the smallest useful experiment; change one variable at a time.
9. Implement the fix at the boundary that actually owns the proven cause. Prefer the smallest complete fix, but do not avoid a broader in-scope change when the root cause crosses boundaries and the larger change is what correctness requires.
10. Add or update focused validation for the original symptom and any invariant the fix relies on; if needed, first add seams or instrumentation that make the fix safe to complete.
11. If the fix fails, reassess with new evidence instead of piling on changes.

## Runtime Tracing Escalation

Use `bpftrace` or similar runtime tracing only when the failure is reproducible but normal logs/tests do not reveal the system boundary involved: syscalls, files, sockets, subprocesses, scheduler behavior, or resource growth. Keep probes scoped to the suspected process or child tree, read-only, and time-bounded; record the script plus observed evidence. Do not require bpftrace for ordinary debugging, and do not treat one traced run as exhaustive correctness proof.

## Stop Conditions
- If you cannot reproduce or observe the failure, gather more evidence before changing production code.
- Do not skip the failing-test-first step just because the fix seems obvious. Only bypass it when a focused failing executable check is genuinely impractical, and say so explicitly.
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
