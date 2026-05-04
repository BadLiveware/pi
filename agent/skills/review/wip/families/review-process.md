# F12 — Review-process / Context Failure

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #tangled-pr

**Pattern:** Multiple unrelated concerns are bundled into one change, making impact analysis, test reasoning, and reviewer attention weaker.

**Likely consequence:** Important issues are missed because reviewers cannot isolate intent or risk.

**Investigation questions:**
- Can the change be decomposed conceptually even if not split immediately?
- Which parts deserve separate scrutiny or specialist review?

**False-positive traps:**
- Some repo-wide codemods are broad but still coherent and low-risk.

## #prompt-overload

**Pattern:** The review setup includes too much irrelevant context, too many generic checks, or no stage-specific routing, causing speculative low-value comments.

**Likely consequence:** Poor signal-to-noise, reviewer distrust, wasted verification effort.

**Investigation questions:**
- Which entries were actually relevant to this change?
- Could routing or staged review reduce noise?
- Are context files helping or distracting?

**False-positive traps:**
- Some broad context is necessary for architecture-sensitive changes; the problem is irrelevant context, not all context.
