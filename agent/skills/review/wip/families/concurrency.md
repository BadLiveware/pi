---
family: concurrency
fid: F10
scope: runtime
evidence_strength: empirical
default_stages: specialist-scout
---

# F10 — Concurrency / Timing / Ordering Hazard

Synchronization or ordering assumptions break. Runtime-sensitive; scout or verifier caution.

Change cues: async fan-out, shared mutable state, retries, timers, callbacks, queue semantics, lock-scope edits.

## #unsynchronized-shared-state
Shared-state access assumptions changed without synchronization review.

- **Pattern:** A change introduces or broadens concurrent access to shared state without re-checking synchronization or atomicity assumptions.
- **Signals:** Shared cache or map edits; async parallelism added; background worker introduced; lock scope changed.
- **Scope:** runtime.
- **Likely consequence:** Races, lost updates, inconsistent reads, flaky behavior.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Can two executions now overlap where they could not before?
  - What protects shared state?
  - Are tests deterministic enough to catch the race?
- **False-positive traps:**
  - Immutability, actor-style isolation, or single-threaded runtimes can make some apparent races impossible.

## #ordering-assumption-drift
Ordering assumption drift across async callbacks, retries, or timers.

- **Pattern:** The change silently depends on a callback, retry, queue, or timer firing in a particular order that is no longer guaranteed.
- **Signals:** Retry logic added; callbacks reordered; timers changed; async task fan-out introduced; queue semantics altered.
- **Scope:** runtime.
- **Likely consequence:** Duplicate effects, missed effects, flaky tests, shutdown races.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - What order is assumed?
  - Is it actually guaranteed?
  - What happens if operations overlap, retry, or complete late?
- **False-positive traps:**
  - Some frameworks provide stronger ordering guarantees than generic async intuition suggests.
