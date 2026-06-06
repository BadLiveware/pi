# Code-intel Feedback Improvements

This plan has been split because the feedback taxonomy and source-of-truth decision must inform the implementation slices.

Use the split plan directory instead:

- `.pi/plans/code-intel-feedback-improvements/README.md`
- `.pi/plans/code-intel-feedback-improvements/slices/01-typescript-package-source-of-truth.md`
- `.pi/plans/code-intel-feedback-improvements/slices/01b-package-adapter-migration.md`
- `.pi/plans/code-intel-feedback-improvements/docs/source-of-truth.md`
- `.pi/plans/code-intel-feedback-improvements/docs/package-integration-decision.md`
- `.pi/plans/code-intel-feedback-improvements/docs/feedback-matrix.md`
- `.pi/plans/code-intel-feedback-improvements/docs/validation.md`

Important source-of-truth note: `/home/fl/code/personal/code-intel/` is the standalone TypeScript package and intended reusable source of truth. Slice 01 chose a local package/library dependency plus `code-intel/pi-integration` facade; the next executable slice is adapter migration.
