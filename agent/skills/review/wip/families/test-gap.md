---
family: test-gap
fid: F6
scope: repo
evidence_strength: empirical
default_stages: medium-reviewer
---

# F6 — Test / Behavioral Evidence Gap

Tests or test plan do not cover changed behavior well. Strong medium-reviewer family.

Change cues: non-trivial behavior change with no test diff; only snapshot churn; vague or happy-path-only test plan.

## #behavior-without-test
Behavior changed but tests did not move with it.

- **Pattern:** Production behavior changes materially, but tests, fixtures, or assertions stay unchanged or too weak.
- **Signals:** Non-trivial code-path edits; no test diff; only snapshot churn; assertions remain broad or indirect.
- **Scope:** repo.
- **Likely consequence:** Regressions slip because the claimed behavior change is not inspectable.
- **Recommended stage:** medium-reviewer.
- **Investigation questions:**
  - Which observable behavior changed?
  - What test would fail before this patch and pass after it?
  - Are edge cases represented?
- **False-positive traps:**
  - Some low-risk refactors legitimately need no test changes.
  - Avoid demanding tests for purely mechanical edits.

## #shallow-test-plan
Test plan explains procedure but not risk-bearing cases.

- **Pattern:** The PR includes a test plan or manual verification story, but it omits edge cases, failure cases, or downstream effects that matter for this change.
- **Signals:** Happy-path-only test plan; vague "tested locally"; no backward-compatibility or rollback story; no mention of affected integrations.
- **Scope:** repo / process.
- **Likely consequence:** Reviewers overestimate coverage and miss important scenarios.
- **Recommended stage:** medium-reviewer.
- **Investigation questions:**
  - What could still break despite the stated test plan?
  - Does the plan cover failure handling, compatibility, and dependent components?
- **False-positive traps:**
  - Small isolated changes may not warrant expansive test narratives.
