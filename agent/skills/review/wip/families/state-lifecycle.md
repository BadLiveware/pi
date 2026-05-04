# F5 — State / Lifecycle / Resource Handling

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #ownership-mismatch

**Pattern:** A resource is created, retained, or handed off under assumptions that no longer match actual ownership or lifetime.

**Likely consequence:** Memory growth, stale handles, double-close, dangling references, or use-after-release-style bugs.

**Investigation questions:**
- Who owns this resource now?
- When is it released?
- Can the object outlive the assumptions of its creator?

**False-positive traps:**
- Long-lived resources may be intentional and safe if pooled or amortized.

## #lifecycle-order-drift

**Pattern:** A change shifts when initialization, teardown, subscription, or callback registration happens.

**Likely consequence:** Missed events, duplicate handlers, partially initialized state, shutdown regressions.

**Investigation questions:**
- What assumptions exist about order?
- Can events fire before init completes or after teardown begins?
- Are callbacks idempotent?

**False-positive traps:**
- Reordering for determinism or latency can be safe if ordering invariants are preserved.
