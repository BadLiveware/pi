# Execute Long Plan Ralph Template

Use this template when `execute-long-plan/SKILL.md` needs a concrete `.ralph/<loop-name>.md` file. Replace every `...` placeholder before starting the loop; unresolved placeholders mean the checklist is not ready.

```markdown
# <Plan Name>

Execute <plan/source> end-to-end without pausing for intermediate status reports.

## Goals
- ...

## Non-goals
- ...

## Source Plan / Scope
- Plan file or user request: ...
- Master overview for split plans: ...
- Numbered files for split plans: ...
- Current scope: ...
- Exit criteria: ...

## Checklist
- [ ] 01-<slice>.md
  - [ ] Concrete implementation item for active file
  - [ ] Concrete validation item for active file
- [ ] 02-<slice>.md
- [ ] Concrete implementation item for single-file plans
- [ ] Concrete validation item for single-file plans
- [ ] Concrete docs or migration item

## Verification
- Pending.

## Notes
- Stop policy: do not emit standalone progress summaries while unblocked in-scope work remains.
```

## Leaf Item Shape

```md
**Goal:** ...
**Files / areas:** ...
**Acceptance criteria:** ...
**Validation:** `<command or inspection>` -> expected signal; gaps: ...
**Risks / notes:** ...
```

## Progress Note Shape

```md
## Verification
- `<command>` -> passed/failed/skipped; key output: ...
- Inspected: ... -> ...
- Remaining gaps: ...

## Notes
- Decision: ...
- Blocker: ...
- Deferred/out-of-scope: ...
```
