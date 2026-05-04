---
family: contract-drift
fid: F2
scope: cross-file
evidence_strength: benchmark-supported
default_stages: specialist-scout
---

# F2 — Contract Drift

Caller/callee or producer/consumer assumptions diverge. Usually cross-file; route to an impact scout.

Change cues: API return shape, nullability, defaults, parameter meaning, units, enum values.

## #return-shape-drift
Return-shape or error-contract drift.

- **Pattern:** A callee's output, error signaling, or nullability changed, but downstream callers or tests still assume the old contract.
- **Signals:** Return-type edits; sentinel/exception conversion; optional field introduced; changed success/error object shape.
- **Scope:** cross-file.
- **Likely consequence:** Downstream runtime errors, silent misinterpretation, incorrect fallback behavior.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Which callers consume this output?
  - Were call sites, mocks, and tests updated?
  - Is there an explicit contract source such as docs, schema, or interface?
- **False-positive traps:**
  - Internal helper contracts may be intentionally private and simultaneously updated elsewhere.
  - Avoid overclaiming from one diff hunk alone.

## #parameter-semantics-drift
Parameter-semantics drift.

- **Pattern:** A parameter's meaning, units, valid range, or default semantics changed without corresponding updates in dependent code.
- **Signals:** Renamed parameter; default value change; enum meaning change; unit-conversion edits; changed interpretation in comments or docs.
- **Scope:** cross-file.
- **Likely consequence:** Behavior remains syntactically valid but semantically wrong.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Did any caller rely on the previous units or defaults?
  - Were serialization, config, CLI, or API docs updated?
  - Are old tests still asserting the old semantics?
- **False-positive traps:**
  - Cosmetic renames or clearer naming are not semantic drift by themselves.
