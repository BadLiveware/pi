---
family: state-lifecycle
fid: F5
scope: local → runtime
evidence_strength: empirical
default_stages: specialist-scout
---

# F5 — State / Lifecycle / Resource Handling

Resource, cleanup, ownership, or state-transition errors. Runtime-sensitive; do not overclaim.

Change cues: caching, pooling, init/teardown, lifecycle hooks, callback registration, handle storage in broader scope.

## #ownership-mismatch
Ownership or lifetime mismatch.

- **Pattern:** A resource is created, retained, or handed off under assumptions that no longer match actual ownership or lifetime.
- **Signals:** Caching added; object retained across requests; pool usage changed; reference or handle stored in broader scope.
- **Scope:** runtime.
- **Likely consequence:** Memory growth, stale handles, double-close, dangling references, or use-after-release-style bugs.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Who owns this resource now?
  - When is it released?
  - Can the object outlive the assumptions of its creator?
- **False-positive traps:**
  - Long-lived resources may be intentional and safe if pooled or amortized.

## #lifecycle-order-drift
Lifecycle callback or initialization order drift.

- **Pattern:** A change shifts when initialization, teardown, subscription, or callback registration happens.
- **Signals:** Moved setup code; constructor changes; hooks added or reordered; listener registration altered.
- **Scope:** local → runtime.
- **Likely consequence:** Missed events, duplicate handlers, partially initialized state, shutdown regressions.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - What assumptions exist about order?
  - Can events fire before init completes or after teardown begins?
  - Are callbacks idempotent?
- **False-positive traps:**
  - Reordering for determinism or latency can be safe if ordering invariants are preserved.
