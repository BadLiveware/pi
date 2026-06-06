# Stardock Checklist Wrapper — Code-intel Feedback Improvements

Use this only after the user asks to execute the plan with Stardock. Keep detailed work in the linked slice files.

## Milestone 1 — Evidence gate

- Execute [`slices/00-feedback-taxonomy.md`](slices/00-feedback-taxonomy.md).
- Produce `docs/source-of-truth.md`.
- Produce `docs/feedback-matrix.md`.
- Update the README execution spine.

Status: completed by Slice 00 execution.

## Milestone 2 — TypeScript package source-of-truth adoption

- Execute [`slices/01-typescript-package-source-of-truth.md`](slices/01-typescript-package-source-of-truth.md).
- Choose how the Pi extension consumes `/home/fl/code/personal/code-intel/`.
- Document the integration boundary and rejected alternatives.
- Create the adapter migration slice that replaces the vendored TypeScript mirror as the behavior source.

Status: completed by choosing a local package/library dependency plus `code-intel/pi-integration` facade and creating [`slices/01b-package-adapter-migration.md`](slices/01b-package-adapter-migration.md).

## Milestone 3 — Adapter migration

- Execute [`slices/01b-package-adapter-migration.md`](slices/01b-package-adapter-migration.md).
- Verify Pi imports reusable behavior from the standalone package.
- Remove or stop owning duplicated common source.

## Milestone 4 — Feedback behavior slices

Run only after Milestone 3 establishes the package source and adapter boundary, unless the user explicitly chooses a temporary mirror bridge.

- Execute [`slices/02-post-edit-summary-boundaries.md`](slices/02-post-edit-summary-boundaries.md).
- Execute [`slices/03-diagnostics-timing-trust.md`](slices/03-diagnostics-timing-trust.md).
- Execute [`slices/04-route-ranking-scope-control.md`](slices/04-route-ranking-scope-control.md).
- Keep deferred candidates in `docs/candidate-backlog.md` unexecuted unless the user reprioritizes them.

## Completion gate

- Pi consumes `/home/fl/code/personal/code-intel/` or a documented package wrapper as reusable source of truth.
- Feedback-backed tests pass in the standalone package and Pi adapter.
- Required Pi extension validation commands pass.
- Documentation matches implemented behavior.
