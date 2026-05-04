# F2 — Contract Drift

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #return-shape-drift

**Pattern:** A callee's output, error signaling, or nullability changed, but downstream callers or tests still assume the old contract.

**Likely consequence:** Downstream runtime errors, silent misinterpretation, incorrect fallback behavior.

**Investigation questions:**
- Which callers consume this output?
- Were call sites, mocks, and tests updated?
- Is there an explicit contract source such as docs, schema, or interface?

**False-positive traps:**
- Internal helper contracts may be intentionally private and simultaneously updated elsewhere.
- Avoid overclaiming from one diff hunk alone.

## #parameter-semantics-drift

**Pattern:** A parameter's meaning, units, valid range, or default semantics changed without corresponding updates in dependent code.

**Likely consequence:** Behavior remains syntactically valid but semantically wrong.

**Investigation questions:**
- Did any caller rely on the previous units or defaults?
- Were serialization, config, CLI, or API docs updated?
- Are old tests still asserting the old semantics?

**False-positive traps:**
- Cosmetic renames or clearer naming are not semantic drift by themselves.
