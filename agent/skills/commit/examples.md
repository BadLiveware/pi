# Commit Skill Examples

Use these examples when editing or testing `commit/SKILL.md`.

## Avoid request-source messages
Avoid:

```text
fix: address PR review feedback
```

Prefer:

```text
fix: keep sweep artifacts stable across reruns

Preserve named artifact directories unless overwrite is explicitly requested so
benchmark sweeps do not silently replace prior results. This keeps repeated
calibration runs reviewable and makes failed reruns easier to diagnose.
```

Avoid:

```text
test: update expectations from review
```

Prefer:

```text
test: cover dense benchmark matrix rendering

Add coverage for dense processing rows so latency-band classification and mode
columns stay stable while the sweep report schema evolves.
```

## Behavior cases
- Manual standalone invocation -> create appropriate commit(s) if changes are ready.
- Ordinary coding task without commit permission -> do not commit.
- Multiple unrelated validated groups -> separate semantic commits.
- Unvalidated code change -> validate first or record the validation gap before committing.
- Source/tests/docs/generated artifacts for one behavior -> one semantic commit.
- Preparatory refactor plus behavior change -> separate commits when each stands alone.
