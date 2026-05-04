---
family: error-path
fid: F4
scope: local → runtime
evidence_strength: benchmark-supported
default_stages: medium-reviewer, specialist-scout
---

# F4 — Error-path / Recovery-path Mismatch

Non-happy paths not updated consistently. Often needs a semantic scout.

Change cues: new throws, retries, timeout handling, early returns, cleanup movement, lock or transaction scope edits.

## #unhandled-failure
New failure source without downstream handling.

- **Pattern:** A change introduces a new possible error, timeout, empty result, or exception path, but callers still assume the old happy-path behavior.
- **Signals:** New `throw`; new fallible I/O; timeout or retry addition; optional return; removed catch.
- **Scope:** local → cross-file.
- **Likely consequence:** Crash, partial write, silent retry storm, or unhelpful user-visible failure.
- **Recommended stage:** medium-reviewer → specialist-scout.
- **Investigation questions:**
  - Who handles this failure now?
  - Are cleanup and rollback still guaranteed?
  - Are user-facing or API-facing errors still coherent?
- **False-positive traps:**
  - Some errors intentionally bubble upward; verify ownership of handling before flagging.

## #cleanup-skipped
Cleanup or rollback skipped on early exit.

- **Pattern:** A new early return or exception path bypasses release, rollback, or state-reset logic.
- **Signals:** Added early `return`; reordered cleanup; resource acquisition moved upward; lock or transaction opened before a new branch.
- **Scope:** local → runtime.
- **Likely consequence:** Leaks, stuck state, partial commits, lock retention, orphaned temporary artifacts.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - What resources or state are now live before each exit?
  - Do all exits pass through equivalent cleanup?
  - Are deferred or finalizer mechanisms still effective?
- **False-positive traps:**
  - Language-level RAII or `defer` patterns may already guarantee cleanup.
