# F10 — Concurrency / Timing / Ordering Hazard

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #unsynchronized-shared-state

**Pattern:** A change introduces or broadens concurrent access to shared state without re-checking synchronization or atomicity assumptions.

**Likely consequence:** Races, lost updates, inconsistent reads, flaky behavior.

**Investigation questions:**
- Can two executions now overlap where they could not before?
- What protects shared state?
- Are tests deterministic enough to catch the race?

**False-positive traps:**
- Immutability, actor-style isolation, or single-threaded runtimes can make some apparent races impossible.

## #ordering-assumption-drift

**Pattern:** The change silently depends on a callback, retry, queue, or timer firing in a particular order that is no longer guaranteed.

**Likely consequence:** Duplicate effects, missed effects, flaky tests, shutdown races.

**Investigation questions:**
- What order is assumed?
- Is it actually guaranteed?
- What happens if operations overlap, retry, or complete late?

**False-positive traps:**
- Some frameworks provide stronger ordering guarantees than generic async intuition suggests.
