# F4 — Error-path / Recovery-path Mismatch

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #unhandled-failure

**Pattern:** A change introduces a new possible error, timeout, empty result, or exception path, but callers still assume the old happy-path behavior.

**Likely consequence:** Crash, partial write, silent retry storm, or unhelpful user-visible failure.

**Investigation questions:**
- Who handles this failure now?
- Are cleanup and rollback still guaranteed?
- Are user-facing or API-facing errors still coherent?

**False-positive traps:**
- Some errors intentionally bubble upward; verify ownership of handling before flagging.

## #cleanup-skipped

**Pattern:** A new early return or exception path bypasses release, rollback, or state-reset logic.

**Likely consequence:** Leaks, stuck state, partial commits, lock retention, orphaned temporary artifacts.

**Investigation questions:**
- What resources or state are now live before each exit?
- Do all exits pass through equivalent cleanup?
- Are deferred or finalizer mechanisms still effective?

**False-positive traps:**
- Language-level RAII or `defer` patterns may already guarantee cleanup.
