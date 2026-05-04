---
family: security-boundary
fid: F9
scope: local → cross-file
evidence_strength: empirical
default_stages: medium-reviewer, specialist-scout
---

# F9 — Security-boundary Regression

Boundary checks or validation drift at trust boundaries. Make narrow, defensible claims.

Change cues: auth, policy, input validation, secret handling, exposure widening, default mode loosening.

## #validation-bypass
Validation or authorization check bypass on a new path.

- **Pattern:** A new path reaches sensitive behavior without the validation, sanitization, or authorization previously expected at the boundary.
- **Signals:** New route or handler; moved auth logic; input path bypassing validation helper; direct sink access added.
- **Scope:** local → cross-file.
- **Likely consequence:** Unauthorized access, unsafe input handling, policy bypass.
- **Recommended stage:** specialist-scout.
- **Investigation questions:**
  - Where is the trust boundary?
  - Does every entry point still pass through equivalent checks?
  - Did tests cover denied and malformed cases?
- **False-positive traps:**
  - Equivalent validation may now exist in middleware or a shared wrapper rather than the local file.

## #privilege-broadened
Insecure default or broadened privilege surface.

- **Pattern:** A change broadens capabilities, permissions, exposure, or defaults without clear justification or compensating controls.
- **Signals:** More permissive policy; secret-handling change; wider wildcard; debug feature exposed; default security mode loosened.
- **Scope:** local → repo.
- **Likely consequence:** Expanded attack surface or accidental privilege escalation.
- **Recommended stage:** medium-reviewer → specialist-scout.
- **Investigation questions:**
  - Is the broader privilege necessary?
  - What is the narrowest safe scope?
  - Were threat assumptions or compensating checks updated?
- **False-positive traps:**
  - Internal-only services or temporary operational changes may have surrounding controls not visible in the diff.
