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

Avoid:

```text
fix: resolve PromQL integration CI findings

Make PromQL over-time lowering build AST predicates with explicit ownership
order so clang-tidy does not see unsequenced use-after-move paths.

Also reserve combined capacity when merging quantile buckets to avoid rehashing
already-present samples during aggregate-state merges.
```

Prefer two commits because these are semantically different fixes:

```text
fix: sequence PromQL predicate ownership

Build over-time AST predicates with explicit ownership order so predicate
construction cannot read moved nodes. This keeps the lowering path compatible
with compiler and analyzer sequencing rules.
```

```text
perf: reserve quantile bucket merge capacity

Reserve the combined sample capacity before merging quantile buckets so aggregate
state merges do not repeatedly rehash already-present samples.
```

## Avoid routine validation trailers
Avoid adding routine expected checks to the commit body:

```text
Validation: npm --prefix agent/extensions test; npm --prefix agent/extensions run typecheck; git diff --check.
```

Prefer omitting that line when those are normal project checks. Report routine validation in the final response, PR notes, task comments, or evidence log instead.

Include validation context only when it changes review or trust, for example:

```text
The cloud import path was validated manually against a staging tenant because the
fixture generator cannot cover provider-side retry behavior.
```

## Behavior cases
- Manual standalone invocation -> create appropriate commit(s) if changes are ready.
- Ordinary coding task -> commit validated intended changes by default unless the user opts out, the task is inspect-only/draft/WIP, or safe staging needs a decision.
- Multiple unrelated validated groups -> separate semantic commits.
- Unvalidated code change -> validate first or record the validation gap before committing.
- Routine expected validation -> do not add a `Validation:` trailer to the commit body; report it in the final response instead.
- Manual, external, skipped, unavailable, benchmark, migration, or otherwise unusual validation -> include concise commit-body context when it affects review or trust.
- Source/tests/docs/generated artifacts for one behavior -> one semantic commit.
- Preparatory refactor plus behavior change -> separate commits when each stands alone.
