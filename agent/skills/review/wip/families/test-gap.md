# F6 — Test / Behavioral Evidence Gap

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #behavior-without-test

**Pattern:** Production behavior changes materially, but tests, fixtures, or assertions stay unchanged or too weak.

**Likely consequence:** Regressions slip because the claimed behavior change is not inspectable.

**Investigation questions:**
- Which observable behavior changed?
- What test would fail before this patch and pass after it?
- Are edge cases represented?

**False-positive traps:**
- Some low-risk refactors legitimately need no test changes.
- Avoid demanding tests for purely mechanical edits.

## #shallow-test-plan

**Pattern:** The PR includes a test plan or manual verification story, but it omits edge cases, failure cases, or downstream effects that matter for this change.

**Likely consequence:** Reviewers overestimate coverage and miss important scenarios.

**Investigation questions:**
- What could still break despite the stated test plan?
- Does the plan cover failure handling, compatibility, and dependent components?

**False-positive traps:**
- Small isolated changes may not warrant expansive test narratives.
