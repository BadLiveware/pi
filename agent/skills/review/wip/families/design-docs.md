# F11 — Design / Docs / Maintainability Mismatch

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #tangled-implementation

**Pattern:** The change solves an immediate problem by increasing duplication, mixing concerns, or bypassing local architecture in ways likely to create future bugs.

**Likely consequence:** Higher future defect rate, harder reviews, inconsistent behavior over time.

**Investigation questions:**
- Is there a local architectural pattern being bypassed?
- Does this make future propagation harder?
- Is there a smaller design fix?

**False-positive traps:**
- Urgent fixes or constrained hot paths may justify localized duplication temporarily.

## #docs-drift

**Pattern:** Code behavior changes materially, but nearby documentation, examples, or comments retain the old story.

**Likely consequence:** Misuse by callers, broken onboarding, incorrect downstream assumptions.

**Investigation questions:**
- Which consumers rely on this documentation?
- Is the changed behavior externally visible or only internal?

**False-positive traps:**
- Outdated comments may predate this PR and not be caused by it; focus on newly created or worsened drift.
