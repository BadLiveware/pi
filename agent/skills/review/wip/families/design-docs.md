---
family: design-docs
fid: F11
scope: local → repo
evidence_strength: benchmark-supported
default_stages: medium-reviewer
---

# F11 — Design / Docs / Maintainability Mismatch

Architecture, readability, documentation, or long-term structure degrades. Suppress taste-only style feedback.

Change cues: duplicated logic, architecture bypass, scattered special cases, public-API behavior change, stale comments or examples.

## #tangled-implementation
Tangled implementation increases future change risk.

- **Pattern:** The change solves an immediate problem by increasing duplication, mixing concerns, or bypassing local architecture in ways likely to create future bugs.
- **Signals:** Copy-pasted branches; feature logic embedded in unrelated layers; special cases scattered; new abstraction only partially adopted.
- **Scope:** local → repo.
- **Likely consequence:** Higher future defect rate, harder reviews, inconsistent behavior over time.
- **Recommended stage:** medium-reviewer.
- **Investigation questions:**
  - Is there a local architectural pattern being bypassed?
  - Does this make future propagation harder?
  - Is there a smaller design fix?
- **False-positive traps:**
  - Urgent fixes or constrained hot paths may justify localized duplication temporarily.

## #docs-drift
Documentation, examples, or comments drift from changed behavior.

- **Pattern:** Code behavior changes materially, but nearby documentation, examples, or comments retain the old story.
- **Signals:** Public API changes; CLI behavior changes; example outputs stale; comment contradicts code.
- **Scope:** local → repo.
- **Likely consequence:** Misuse by callers, broken onboarding, incorrect downstream assumptions.
- **Recommended stage:** medium-reviewer.
- **Investigation questions:**
  - Which consumers rely on this documentation?
  - Is the changed behavior externally visible or only internal?
- **False-positive traps:**
  - Outdated comments may predate this PR and not be caused by it; focus on newly created or worsened drift.
