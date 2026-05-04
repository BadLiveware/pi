---
family: review-process
fid: F12
scope: process / repo
evidence_strength: practical-heuristic
default_stages: medium-reviewer, verifier
---

# F12 — Review-process / Context Failure

The review setup itself makes important issues hard to detect. Useful for reviewer/system-designer meta feedback.

Change cues: tangled PR, giant prompt, all heuristics injected at once, missing reduction stage, repeated style nits.

## #tangled-pr
Tangled PR hides independent concerns.

- **Pattern:** Multiple unrelated concerns are bundled into one change, making impact analysis, test reasoning, and reviewer attention weaker.
- **Signals:** Refactor + feature + rename + dependency bump in one PR; many files with unrelated motives; hard-to-explain review narrative.
- **Scope:** process / repo.
- **Likely consequence:** Important issues are missed because reviewers cannot isolate intent or risk.
- **Recommended stage:** medium-reviewer.
- **Investigation questions:**
  - Can the change be decomposed conceptually even if not split immediately?
  - Which parts deserve separate scrutiny or specialist review?
- **False-positive traps:**
  - Some repo-wide codemods are broad but still coherent and low-risk.

## #prompt-overload
Prompt or context overload amplifies noisy findings.

- **Pattern:** The review setup includes too much irrelevant context, too many generic checks, or no stage-specific routing, causing speculative low-value comments.
- **Signals:** Giant prompt; all heuristics injected at once; repeated stylistic comments; missing reduction or verifier stage.
- **Scope:** process.
- **Likely consequence:** Poor signal-to-noise, reviewer distrust, wasted verification effort.
- **Recommended stage:** verifier / system-designer.
- **Investigation questions:**
  - Which entries were actually relevant to this change?
  - Could routing or staged review reduce noise?
  - Are context files helping or distracting?
- **False-positive traps:**
  - Some broad context is necessary for architecture-sensitive changes; the problem is irrelevant context, not all context.
