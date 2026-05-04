# F9 — Security-boundary Regression

Operational charter for scouts and verifiers. Routing (signals, scope, stage, evidence strength, change cues) lives in `../family-routing-table.md`.

## #validation-bypass

**Pattern:** A new path reaches sensitive behavior without the validation, sanitization, or authorization previously expected at the boundary.

**Likely consequence:** Unauthorized access, unsafe input handling, policy bypass.

**Investigation questions:**
- Where is the trust boundary?
- Does every entry point still pass through equivalent checks?
- Did tests cover denied and malformed cases?

**False-positive traps:**
- Equivalent validation may now exist in middleware or a shared wrapper rather than the local file.

## #privilege-broadened

**Pattern:** A change broadens capabilities, permissions, exposure, or defaults without clear justification or compensating controls.

**Likely consequence:** Expanded attack surface or accidental privilege escalation.

**Investigation questions:**
- Is the broader privilege necessary?
- What is the narrowest safe scope?
- Were threat assumptions or compensating checks updated?

**False-positive traps:**
- Internal-only services or temporary operational changes may have surrounding controls not visible in the diff.
